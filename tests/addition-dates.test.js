import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORD_STORAGE_KEY, DATE_UNDO_KEY, BASE_INSTANT, normalizeHistoricalDates, applyDateRepair, undoDateRepair, hasDateUndo } from '../addition-dates.js';

function state() {
  const word = (id, added_at, extra = {}) => ({ id, word: id, meaning: `${id}の訳`, active: true, ...extra, ...(added_at === undefined ? {} : { added_at }) });
  return { schemaVersion: 2, words: [word('unknown'), word('old', '2026-11-09T06:26:39Z'),
    word('today', '2026-11-22T15:00:00Z'), word('yesterday', '2026-11-22T14:59:59Z'), word('future', '2026-11-24T00:00:00Z'),
    word('baseline', '2026-10-31T16:00:00Z'), word('inactive', undefined, { active: false })],
    records: [{ wordId: 'old', wrongCount: 7, correctCount: 3, nextReviewAt: '2026-12-01', answerHistory: [{ id: 'original', result: 'correct' }] }],
    settings: { feedUrl: 'https://example.test/feed', arbitrarySetting: true }, extraState: { keep: 'all unknown fields' } };
}
function storage(value = state()) {
  const map = new Map(value ? [[WORD_STORAGE_KEY, JSON.stringify(value)], ['world-history', 'untouched']] : []);
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
test('normalizes only older and unknown dates, includes inactive words and preserves every learning field', () => {
  const before = state(), raw = JSON.stringify(before), result = normalizeHistoricalDates(before);
  assert.equal(result.changes.length, 4); assert.equal(result.preserved, 2);
  assert.deepEqual(result.state.words.map(w => w.added_at), [BASE_INSTANT, BASE_INSTANT, before.words[2].added_at, BASE_INSTANT, before.words[4].added_at, before.words[5].added_at, BASE_INSTANT]);
  assert.deepEqual(result.state.records, before.records); assert.deepEqual(result.state.settings, before.settings); assert.deepEqual(result.state.extraState, before.extraState);
  assert.deepEqual(result.state.words.map(w => { const { added_at, ...rest } = w; return rest; }), before.words.map(w => { const { added_at, ...rest } = w; return rest; }));
  assert.equal(JSON.stringify(before), raw); assert.equal(normalizeHistoricalDates(result.state).changes.length, 0);
});
test('undo restores only changed dates and keeps subsequent learning, synchronization and newer words', () => {
  const before = state(), store = storage(before); applyDateRepair(store); assert.equal(hasDateUndo(store), true);
  const current = JSON.parse(store.getItem(WORD_STORAGE_KEY)); current.records[0].wrongCount++;
  current.records[0].answerHistory.push({ id: 'new-event', result: 'wrong' });
  current.words.push({ id: 'newer', word: 'newer', meaning: '後で追加', added_at: '2026-11-25T00:00:00Z' });
  current.settings.anotherChange = 'keep'; store.setItem(WORD_STORAGE_KEY, JSON.stringify(current));
  assert.equal(undoDateRepair(store), 4);
  const restored = JSON.parse(store.getItem(WORD_STORAGE_KEY));
  assert.deepEqual(restored.words.slice(0, before.words.length), before.words); assert.deepEqual(restored.words.at(-1), current.words.at(-1));
  assert.deepEqual(restored.records, current.records); assert.deepEqual(restored.settings, current.settings);
  assert.equal(hasDateUndo(store), false); assert.equal(store.getItem('world-history'), 'untouched');
});
test('a repeated click retains the first undo snapshot; later intentional date edits are never rolled back', () => {
  const store = storage(); applyDateRepair(store); const backup = store.getItem(DATE_UNDO_KEY);
  assert.equal(applyDateRepair(store).changes.length, 0); assert.equal(store.getItem(DATE_UNDO_KEY), backup);
  const current = JSON.parse(store.getItem(WORD_STORAGE_KEY)); current.words[1].added_at = '2026-11-10T00:00:00Z'; store.setItem(WORD_STORAGE_KEY, JSON.stringify(current));
  undoDateRepair(store); assert.equal(JSON.parse(store.getItem(WORD_STORAGE_KEY)).words[1].added_at, current.words[1].added_at);
});
test('empty or corrupt data is not initialized, and malformed undo cannot overwrite the original', () => {
  const empty = storage(null); assert.throws(() => applyDateRepair(empty)); assert.equal(empty.map.size, 0);
  for (const date of ['bad', '2026-02-30', '2026-11-22T12:00:00']) {
    const invalid = state(); invalid.words[0].added_at = date; const store = storage(invalid), raw = store.getItem(WORD_STORAGE_KEY);
    assert.throws(() => applyDateRepair(store)); assert.equal(store.getItem(WORD_STORAGE_KEY), raw); assert.equal(store.getItem(DATE_UNDO_KEY), null);
  }
  const store = storage(), raw = store.getItem(WORD_STORAGE_KEY); store.setItem(DATE_UNDO_KEY, 'broken');
  assert.throws(() => applyDateRepair(store)); assert.equal(store.getItem(WORD_STORAGE_KEY), raw);
});
test('backup and main storage failures leave the existing word and learning state intact', () => {
  for (const failingKey of [DATE_UNDO_KEY, WORD_STORAGE_KEY]) {
    const store = storage(), raw = store.getItem(WORD_STORAGE_KEY), write = store.setItem;
    store.setItem = (key, value) => { if (key === failingKey) throw Error('quota'); write(key, value); };
    assert.throws(() => applyDateRepair(store)); assert.equal(store.getItem(WORD_STORAGE_KEY), raw);
  }
});
