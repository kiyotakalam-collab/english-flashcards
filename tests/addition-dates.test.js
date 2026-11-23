import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORD_STORAGE_KEY, DATE_UNDO_KEY, BASE_INSTANT, normalizeHistoricalDates, applyDateRepair, undoDateRepair, hasDateUndo } from '../addition-dates.js';
import { CORRECTION_KEY, TODAY_INSTANT, correctAdditionDates, undoCorrection } from '../addition-date-recovery.js';

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
test('normalizes only known older dates and never guesses dates of unknown or inactive words', () => {
  const before = state(), raw = JSON.stringify(before), result = normalizeHistoricalDates(before);
  assert.equal(result.changes.length, 2); assert.equal(result.preserved, 2); assert.equal(result.unknown, 2);
  assert.deepEqual(result.state.words.map(w => w.added_at), [undefined, BASE_INSTANT, before.words[2].added_at, BASE_INSTANT, before.words[4].added_at, before.words[5].added_at, undefined]);
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
  assert.equal(undoDateRepair(store), 2);
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
test('explicit recovery fixes only selected unknown or incorrectly normalized dates, preserving known today and future dates', () => {
  const before = state(); before.words[1].added_at = BASE_INSTANT;
  const store = storage(before);
  assert.equal(correctAdditionDates(store, ['unknown', 'old', 'today', 'future']), 2);
  const after = JSON.parse(store.getItem(WORD_STORAGE_KEY));
  assert.equal(after.words[0].added_at, TODAY_INSTANT); assert.equal(after.words[1].added_at, TODAY_INSTANT);
  assert.deepEqual(after.words.slice(2), before.words.slice(2));
  assert.deepEqual(after.records, before.records); assert.deepEqual(after.settings, before.settings);
  assert.deepEqual(after.extraState, before.extraState); assert.equal(store.getItem('world-history'), 'untouched');
  const snapshot = store.getItem(CORRECTION_KEY);
  assert.equal(correctAdditionDates(store, ['unknown', 'old']), 0); assert.equal(store.getItem(CORRECTION_KEY), snapshot);
  after.records[0].wrongCount++; after.words.push({ id: 'new', word: 'new', meaning: '新規', added_at: '2026-11-25' });
  store.setItem(WORD_STORAGE_KEY, JSON.stringify(after));
  assert.equal(undoCorrection(store), 2);
  const restored = JSON.parse(store.getItem(WORD_STORAGE_KEY));
  assert.deepEqual(restored.words.slice(0, before.words.length), before.words);
  assert.deepEqual(restored.words.at(-1), after.words.at(-1)); assert.deepEqual(restored.records, after.records);
});
test('old cleanup undo and selected-day recovery remain compatible without overwriting subsequent intentional dates', () => {
  const store = storage(), before = state();
  // Reproduce the first release which also normalized unknown dates.
  const original = before.words.filter(w => !w.added_at || w.id === 'old' || w.id === 'yesterday');
  store.setItem(DATE_UNDO_KEY, JSON.stringify({version:1,target:BASE_INSTANT,keepFrom:'2026-11-23',changes:original.map(w=>({id:w.id,hadDate:Object.hasOwn(w,'added_at'),value:w.added_at??null}))}));
  const changed = structuredClone(before);
  changed.words = changed.words.map(w => original.some(row=>row.id===w.id)?{...w,added_at:BASE_INSTANT}:w);
  store.setItem(WORD_STORAGE_KEY, JSON.stringify(changed));
  correctAdditionDates(store, ['unknown']); undoDateRepair(store);
  const restored = JSON.parse(store.getItem(WORD_STORAGE_KEY));
  assert.equal(restored.words[0].added_at, TODAY_INSTANT); assert.deepEqual(restored.words.slice(1), before.words.slice(1));
  restored.words[0].added_at = '2026-11-24'; store.setItem(WORD_STORAGE_KEY, JSON.stringify(restored));
  assert.equal(undoCorrection(store), 0); assert.equal(JSON.parse(store.getItem(WORD_STORAGE_KEY)).words[0].added_at, '2026-11-24');
});
test('recovery rejects empty or stale selections and storage failures without touching saved history', () => {
  const empty = storage(null); assert.throws(()=>correctAdditionDates(empty,['unknown'])); assert.equal(empty.map.size,0);
  for(const ids of [[],['missing'],['unknown','missing']]){
    const store=storage(),raw=store.getItem(WORD_STORAGE_KEY);assert.throws(()=>correctAdditionDates(store,ids));assert.equal(store.getItem(WORD_STORAGE_KEY),raw);
  }
  for(const fail of [CORRECTION_KEY,WORD_STORAGE_KEY]){
    const store=storage(),raw=store.getItem(WORD_STORAGE_KEY),write=store.setItem;
    store.setItem=(key,value)=>{if(key===fail)throw Error('quota');write(key,value);};
    assert.throws(()=>correctAdditionDates(store,['unknown']));assert.equal(store.getItem(WORD_STORAGE_KEY),raw);
  }
});
