import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWord, isReviewDue, tokyoDateKey, normalizeSchedule, scheduleAnswer } from '../repetition.js';
import { STATE_KEY, LEGACY_KEY, createState, emptyRecord, initializeState, recordAnswer, restoreBackup, validateState, upsertWords, approveDeactivations } from '../core.js';

const words = [{ id: 'one', word: 'one', meaning: '一', sources: 'ex' }];
const at = '2026-11-10T14:59:00.000Z';
const day = 86400000;
const later = (timestamp, milliseconds) => new Date(Date.parse(timestamp) + milliseconds).toISOString();
const answer = (state, correct, now = at) => recordAnswer(state, 'one', correct, now);
const store = entries => {
  const map = new Map(Object.entries(entries));
  let writes = 0;
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => { writes++; map.set(key, value); }, get writes() { return writes; } };
};
const historical = (result = 'correct') => ({ wordId: 'one', correctCount: 70, wrongCount: 8, lastReviewedAt: at, lastResult: result });

test('Tokyo date grouping crosses midnight, month, leap day, and year independently of host timezone', () => {
  assert.equal(tokyoDateKey(at), '2026-11-10');
  assert.equal(tokyoDateKey(later(at, 60000)), '2026-11-11');
  assert.equal(tokyoDateKey('2026-12-31T15:00:00Z'), '2027-01-01');
  assert.equal(tokyoDateKey('2024-02-28T15:00:00Z'), '2024-02-29');
  assert.equal(tokyoDateKey(new Date(at)), tokyoDateKey(Date.parse(at)));
  for (const value of [null, false, {}, NaN, Infinity, 'bad', new Date(NaN)]) assert.throws(() => tokyoDateKey(value));
});

test('legacy attempts recheck regardless of result or counters and have no inferred deadline', () => {
  for (const result of ['correct', 'wrong', null]) {
    const record = historical(result);
    assert.deepEqual(normalizeSchedule(record), { correctStreak: 0, intervalDays: 0, nextReviewAt: null });
    assert.equal(classifyWord(record, at), 'recheck');
    assert.equal(isReviewDue(record, at), false);
  }
  assert.equal(classifyWord(undefined, at), 'new');
  assert.equal(classifyWord(emptyRecord('one'), at), 'new');
  assert.equal(isReviewDue(undefined, at), false);
});

test('correct scheduling follows all six elapsed-day intervals; early answers cannot advance', () => {
  let state = createState(words), now = at;
  for (const [index, intervalDays] of [1, 3, 7, 14, 30, 60, 60].entries()) {
    state = answer(state, true, now);
    const record = state.records[0];
    assert.equal(record.correctStreak, Math.min(index + 1, 6));
    assert.equal(record.intervalDays, intervalDays);
    assert.equal(record.nextReviewAt, later(now, intervalDays * day));
    assert.equal(classifyWord(record, now), index >= 4 ? 'mastered' : 'learning');
    const early = answer(state, true, later(record.nextReviewAt, -1));
    assert.deepEqual(normalizeSchedule(early.records[0]), normalizeSchedule(record));
    assert.equal(isReviewDue(record, later(record.nextReviewAt, -1)), false);
    assert.equal(isReviewDue(record, record.nextReviewAt), true);
    assert.equal(classifyWord(record, later(record.nextReviewAt, 1)), 'weak');
    now = record.nextReviewAt;
  }
});

test('rapid and next-calendar-day early answers log every result but cannot manufacture mastery', () => {
  let state = answer(createState(words), true);
  const schedule = normalizeSchedule(state.records[0]);
  for (let index = 0; index < 20; index++) state = answer(state, true, later(at, index * 1000));
  state = answer(state, true, later(at, 60000)); // Tokyo day changes, only one minute elapsed.
  assert.equal(state.records[0].correctCount, 22);
  assert.equal(state.records[0].answerHistory.length, 22);
  assert.equal(new Set(state.records[0].answerHistory.map(event => event.id)).size, 22);
  assert.deepEqual(normalizeSchedule(state.records[0]), schedule);
  assert.equal(classifyWord(state.records[0], later(at, 60000)), 'learning');
});

test('wrong answers retain cumulative counts, reset mastery and retry exactly ten minutes later', () => {
  let state = createState(words), now = at;
  for (let i = 0; i < 6; i++) { state = answer(state, true, now); now = state.records[0].nextReviewAt; }
  state = answer(state, false, now);
  const record = state.records[0];
  assert.equal(record.correctCount, 6);
  assert.equal(record.wrongCount, 1);
  assert.deepEqual(normalizeSchedule(record), { correctStreak: 0, intervalDays: 0, nextReviewAt: later(now, 600000) });
  assert.equal(classifyWord(record, now), 'weak');
  assert.equal(isReviewDue(record, later(now, 599999)), false);
  assert.equal(isReviewDue(record, later(now, 600000)), true);
  const recovered = answer(state, true, record.nextReviewAt).records[0];
  assert.equal(recovered.correctStreak, 1);
  assert.equal(recovered.wrongCount, 1);
  assert.equal(classifyWord(recovered, record.nextReviewAt), 'learning');
});

test('schedule helpers are pure and malformed metadata rejects instead of silently disappearing', () => {
  const record = Object.freeze({ ...historical(), ...scheduleAnswer(undefined, true, at) });
  const before = JSON.stringify(record);
  scheduleAnswer(record, true, later(at, day));
  classifyWord(record, at);
  assert.equal(JSON.stringify(record), before);
  for (const fields of [
    { correctStreak: 1 }, { correctStreak: -1, intervalDays: 0, nextReviewAt: null },
    { correctStreak: 1.5, intervalDays: 1, nextReviewAt: at },
    { correctStreak: 5, intervalDays: 1, nextReviewAt: at },
    { correctStreak: 1, intervalDays: 1, nextReviewAt: null },
    { correctStreak: 0, intervalDays: 0, nextReviewAt: 'invalid' },
    { correctStreak: 0, intervalDays: 60, nextReviewAt: at }
  ]) assert.throws(() => normalizeSchedule(fields));
  assert.throws(() => scheduleAnswer(record, 'correct', at));
});

test('old schemaVersion 2 storage migrates once under the same key without invented reviews', () => {
  const original = { ...createState(words), records: [historical('wrong')], legacyMigrated: true };
  const storage = store({ [STATE_KEY]: JSON.stringify(original) });
  const migrated = initializeState(storage, words);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(STATE_KEY, 'ex_flashcards_pwa_v2');
  assert.deepEqual(migrated.records[0], { ...historical('wrong'), ...normalizeSchedule(), answerHistory: [] });
  assert.equal(migrated.words[0].sources, 'ex');
  assert.equal(storage.writes, 1);
  assert.deepEqual(initializeState(storage, words), migrated);
  assert.equal(storage.writes, 1);
  assert.equal(classifyWord(migrated.records[0], at), 'recheck');
  const reviewed = answer(migrated, true, later(at, day));
  assert.equal(reviewed.records[0].correctStreak, 1);
  assert.equal(reviewed.records[0].answerHistory.length, 1);
});

test('legacy storage and legacy backup keep counts without fabricating timestamped answers', () => {
  const legacy = JSON.stringify([{ word: 'ONE', right: 21, wrong: 3 }]);
  const storage = store({ [LEGACY_KEY]: legacy });
  const state = initializeState(storage, words);
  assert.equal(storage.getItem(LEGACY_KEY), legacy);
  assert.equal(classifyWord(state.records[0], at), 'recheck');
  assert.deepEqual(state.records[0].answerHistory, []);
  assert.equal(state.records[0].correctCount, 21);
  assert.deepEqual(restoreBackup(state, JSON.parse(legacy)), state);
});

test('backup restoration preserves schedules, source union, settings and every review event idempotently', () => {
  const base = answer(createState(words), true);
  const backup = answer(base, false, later(at, day));
  backup.words[0].sources = 'reading';
  const current = answer(base, true, later(at, 2 * day));
  current.settings.feedUrl = 'https://current.example/feed';
  const input = JSON.stringify(current), backupInput = JSON.stringify(backup);
  const restored = restoreBackup(current, backup);
  assert.equal(restored.records[0].answerHistory.length, 3);
  assert.equal(restored.records[0].wrongCount, 1);
  assert.equal(restored.records[0].correctCount, 2);
  assert.deepEqual(normalizeSchedule(restored.records[0]), normalizeSchedule(current.records[0]));
  assert.equal(restored.words[0].sources, 'ex|reading');
  assert.equal(restored.settings.feedUrl, current.settings.feedUrl);
  assert.deepEqual(restoreBackup(restored, backup), restored);
  assert.equal(JSON.stringify(current), input);
  assert.equal(JSON.stringify(backup), backupInput);
  const fresh = restoreBackup(createState(words), JSON.parse(JSON.stringify(restored)));
  assert.deepEqual(fresh.records, restored.records);
  assert.deepEqual(validateState(fresh).records, fresh.records);
});

test('newer wrong review wins over an older larger streak, comparing timestamp instants', () => {
  let current = answer(createState(words), true);
  current = answer(current, true, later(at, day));
  const newer = answer(createState(words), false, later(at, 5 * day));
  const merged = restoreBackup(current, newer);
  assert.deepEqual(normalizeSchedule(merged.records[0]), normalizeSchedule(newer.records[0]));
  assert.equal(merged.records[0].lastResult, 'wrong');
  assert.equal(merged.records[0].correctCount, 2);
  const offsetBackup = structuredClone(newer);
  offsetBackup.records[0].lastReviewedAt = '2026-11-16T00:00:00+09:00';
  const latest = restoreBackup(newer, offsetBackup);
  assert.equal(latest.records[0].lastReviewedAt, offsetBackup.records[0].lastReviewedAt);
});

test('timestamp ties preserve local schedules, while same known review can enrich an unscheduled client', () => {
  const local = answer(createState(words), true);
  const conflict = answer(createState(words), false);
  const merged = restoreBackup(local, conflict);
  assert.deepEqual(normalizeSchedule(merged.records[0]), normalizeSchedule(local.records[0]));
  assert.equal(merged.records[0].lastResult, 'correct');
  assert.equal(merged.records[0].answerHistory.length, 2);
  const old = { ...createState(words), records: [{ ...historical(), correctCount: 1, wrongCount: 0 }] };
  const enriched = restoreBackup(old, local);
  assert.deepEqual(normalizeSchedule(enriched.records[0]), normalizeSchedule(local.records[0]));
  assert.deepEqual(restoreBackup(enriched, local), enriched);
});

test('newer historical review becomes recheck, but old/legacy imports cannot erase a current schedule', () => {
  const scheduled = answer(createState(words), true);
  const old = { ...createState(words), records: [{ ...historical('wrong'), lastReviewedAt: later(at, day) }] };
  const restored = restoreBackup(scheduled, old);
  assert.equal(classifyWord(restored.records[0], later(at, day)), 'recheck');
  assert.equal(restored.records[0].answerHistory.length, 1);
  const legacy = restoreBackup(scheduled, [{ word: 'one', right: 200, wrong: 100 }]);
  assert.deepEqual(normalizeSchedule(legacy.records[0]), normalizeSchedule(scheduled.records[0]));
  assert.equal(legacy.records[0].answerHistory.length, 1);
});

test('sync and deactivation preserve every review and its schedule without duplicated records', () => {
  const original = answer(createState(words), false);
  const updated = upsertWords(original, [{ ...words[0], meaning: '修正', sources: 'reading', active: false }]).state;
  const hidden = approveDeactivations(updated);
  assert.deepEqual(hidden.records, original.records);
  assert.equal(hidden.words[0].sources, 'ex|reading');
  assert.throws(() => answer(hidden, true));
});

test('conflicting event IDs and corrupt histories reject atomically, leaving storage/input untouched', () => {
  const current = answer(createState(words), true), before = JSON.stringify(current);
  for (const change of [
    record => { record.answerHistory = null; },
    record => { record.answerHistory.push(record.answerHistory[0]); },
    record => { record.answerHistory[0].reviewedAt = 'invalid'; },
    record => { record.answerHistory[0].result = 'maybe'; },
    record => { record.intervalDays = 99; }
  ]) {
    const bad = structuredClone(current); change(bad.records[0]);
    assert.throws(() => restoreBackup(current, bad));
    const storage = store({ [STATE_KEY]: JSON.stringify(bad) });
    assert.throws(() => initializeState(storage, words));
    assert.equal(storage.writes, 0);
  }
  const conflict = structuredClone(current);
  conflict.records[0].answerHistory[0].result = 'wrong';
  assert.throws(() => restoreBackup(current, conflict));
  assert.equal(JSON.stringify(current), before);
});
