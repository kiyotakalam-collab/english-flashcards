import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATE_KEY, LEGACY_KEY, createState, initializeState, recordAnswer, upsertWords, parseFeed, parseCSV, restoreBackup, validateState, validateFeedUrl, approveDeactivations, normalizeSources, mergeSources, matchesSource } from '../core.js';

const initial = JSON.parse(readFileSync(new URL('../initial_words.json', import.meta.url)));
const memory = entries => {
  const map = new Map(Object.entries(entries || {}));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
};
const grade = (state, correct) => recordAnswer(state, 'clumsy', correct);
test('all 308 original words and translations are preserved without duplicates', () => {
  const state = createState(initial);
  assert.equal(state.words.length, 308);
  assert.equal(new Set(state.words.map(word => word.id)).size, 308);
  for (const word of initial) assert.deepEqual(state.words.find(row => row.id === word.id), { ...word, range: '', active: true, updated_at: '' });
});
test('five wrong answers and one correct remain cumulative, including after persistence', () => {
  let state = createState(initial);
  for (let i = 0; i < 5; i++) state = grade(state, false);
  state = grade(state, true);
  const store = memory({ [STATE_KEY]: JSON.stringify({ ...state, legacyMigrated: true }) });
  const record = initializeState(store, initial).records[0];
  assert.equal(record.wrongCount, 5); assert.equal(record.correctCount, 1);
  assert.equal(record.lastResult, 'correct'); assert.ok(record.lastReviewedAt);
  assert.equal(createState(initial).records.length, 0);
});
test('sync is idempotent; changing spelling/translation/range by fixed id retains history', () => {
  let state = grade(createState(initial), false);
  const feed = [{ id: 'new-word-1', word: 'new word', meaning: '新語' }, { ...initial[0], word: 'clumsy (adj.)', meaning: '不器用な【修正】', range: '1-100' }];
  const result = upsertWords(state, feed);
  state = upsertWords(result.state, feed).state;
  assert.equal(result.added, 1); assert.equal(state.words.length, 309);
  assert.equal(state.records[0].wrongCount, 1);
  assert.equal(state.words[0].meaning, '不器用な【修正】');
  assert.equal(state.words[0].word, 'clumsy (adj.)');
});
test('missing rows are retained; deactivation requires confirmation and retains records', () => {
  const original = grade(createState(initial), false);
  let state = upsertWords(original, [{ ...initial[0], active: false }]).state;
  assert.equal(state.words.length, 308); assert.equal(state.words[0].active, true);
  assert.deepEqual(state.settings.pendingDeactivations, ['clumsy']);
  state = approveDeactivations(state);
  assert.equal(state.words[0].active, false); assert.equal(state.records[0].wrongCount, 1);
  assert.equal(upsertWords(state, [initial[0]]).state.words[0].active, true);
  state = upsertWords(original, [{ ...initial[0], active: false }]).state;
  assert.deepEqual(upsertWords(state, [initial[0]]).state.settings.pendingDeactivations, []);
});
test('CSV supports BOM, CRLF, comma, escaped quote and multiline meaning', () => {
  const csv = '\uFEFFid,word,meaning,range,active,updated_at\r\na,a,"意味,\n""引用""",1-100,TRUE,2026-01-01\r\nb,b,意味,,FALSE,\r\n';
  const words = parseFeed(csv);
  assert.equal(words.length, 2); assert.equal(words[0].meaning, '意味,\n"引用"');
  assert.equal(words[1].active, false);
  assert.equal(parseFeed(JSON.stringify({ words: initial })).length, 308);
});
test('malformed or conflicting feeds reject atomically without mutating state', () => {
  const state = grade(createState(initial), false), snapshot = JSON.stringify(state);
  for (const bad of [
    '<html>Sign in</html>', 'id,word,meaning\na,a,"unfinished', 'id,word,meaning\na,a,"x"oops',
    'id,word,meaning\na,a,x,extra', 'word,meaning\na,x', '[]', '{}',
    JSON.stringify([{ id: '1', word: 'same', meaning: 'x' }, { id: '2', word: ' SAME ', meaning: 'y' }]),
    JSON.stringify([{ id: '1', word: 'one', meaning: 'x' }, { id: '1', word: 'two', meaning: 'y' }]),
    JSON.stringify([{ id: '1', word: 'one', meaning: 'x', active: 'maybe' }])
  ]) assert.throws(() => parseFeed(bad));
  assert.throws(() => upsertWords(state, [{ id: 'reassigned', word: 'clumsy', meaning: '訳' }]));
  assert.equal(JSON.stringify(state), snapshot);
  assert.equal(parseFeed(JSON.stringify([initial[0], initial[0]])).length, 1);
});
test('same-origin old storage migrates once, by normalized word; original storage is untouched', () => {
  const legacy = JSON.stringify([{ word: ' CLUMSY ', meaning: '以前の訳', right: 3, wrong: 9 }, { word: 'custom', meaning: '追加語', right: 1, wrong: 2 }]);
  const storage = memory({ [LEGACY_KEY]: legacy });
  const state = initializeState(storage, initial);
  assert.equal(state.words.length, 309); assert.equal(state.records[0].wordId, 'clumsy');
  assert.equal(state.records[0].wrongCount, 9); assert.equal(state.records[0].correctCount, 3);
  assert.equal(state.words[0].meaning, initial[0].meaning);
  assert.equal(storage.getItem(LEGACY_KEY), legacy);
  assert.deepEqual(initializeState(storage, initial), state);
});
test('old and new backups merge monotonically and repeated imports never inflate counts', () => {
  let state = grade(grade(createState(initial), false), true);
  const legacy = [{ word: 'CLUMSY', meaning: '以前の訳', right: 4, wrong: 0 }];
  state = restoreBackup(state, legacy);
  assert.equal(state.records[0].correctCount, 4); assert.equal(state.records[0].wrongCount, 1);
  assert.deepEqual(restoreBackup(state, legacy), state);
  const backup = grade(grade(createState(initial), false), false);
  state = restoreBackup(state, backup);
  assert.equal(state.records[0].correctCount, 4); assert.equal(state.records[0].wrongCount, 2);
  assert.deepEqual(restoreBackup(state, backup), state);
});
test('old custom words with no translation keep their history and can be reopened', () => {
  const state = restoreBackup(createState(initial), [{ word: 'untranslated', meaning: '', right: 2, wrong: 7 }]);
  assert.equal(state.words.at(-1).meaning, '（訳は未登録）');
  assert.equal(validateState(state).records[0].wrongCount, 7);
});
test('backup import preserves latest master and local sync settings and supports fresh-device recovery', () => {
  let backup = grade(createState(initial), false);
  backup.settings.feedUrl = 'https://old.example/feed';
  const current = upsertWords(createState(initial), [{ ...initial[0], meaning: '修正版' }]).state;
  current.settings.feedUrl = 'https://current.example/feed';
  const restored = restoreBackup(current, backup);
  assert.equal(restored.words[0].meaning, '修正版');
  assert.equal(restored.settings.feedUrl, 'https://current.example/feed');
  backup = upsertWords(backup, [{ id: 'extra', word: 'extra', meaning: '追加' }]).state;
  backup = recordAnswer(backup, 'extra', false);
  const fresh = restoreBackup(createState(initial), JSON.parse(JSON.stringify(backup)));
  assert.equal(fresh.words.length, 309); assert.equal(fresh.records.find(record => record.wordId === 'extra').wrongCount, 1);
});
test('corrupted backups/storage never overwrite current data; invalid counters are rejected', () => {
  const state = grade(createState(initial), false), snapshot = JSON.stringify(state);
  for (const invalid of [-1, 1.5, '2', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => restoreBackup(state, [{ word: 'clumsy', right: invalid, wrong: 0 }]));
  }
  assert.throws(() => validateState({ ...state, records: [{ ...state.records[0], wordId: 'missing' }] }));
  assert.throws(() => restoreBackup(state, [{ word: 'clumsy', right: 1, wrong: 1 }, { word: ' CLUMSY ', right: 0, wrong: 0 }]));
  const storage = memory({ [STATE_KEY]: '{bad json' });
  assert.throws(() => initializeState(storage, initial));
  assert.equal(storage.getItem(STATE_KEY), '{bad json'); assert.equal(JSON.stringify(state), snapshot);
  const corruptLegacy = memory({ [LEGACY_KEY]: '{bad' });
  assert.throws(() => initializeState(corruptLegacy, initial)); assert.equal(corruptLegacy.getItem(STATE_KEY), null);
});
test('public URLs must be HTTPS without embedded credentials', () => {
  for (const url of ['javascript:alert(1)', 'http://example.org/feed', '/feed', 'https://user:password@example.org/feed']) assert.throws(() => validateFeedUrl(url));
  assert.equal(validateFeedUrl(''), '');
  assert.equal(validateFeedUrl(' https://example.org/feed '), 'https://example.org/feed');
});

test('source tags filter EX and reading without creating duplicate cards or scores', () => {
  let state = createState(initial);
  assert.equal(state.words.filter(word => matchesSource(word, 'ex')).length, 308);
  assert.equal(state.words.filter(word => matchesSource(word, 'reading')).length, 0);
  state = recordAnswer(state, 'clumsy', false);
  const reading = { id: 'reading-only', word: 'reading-only', meaning: '長文の語', sources: 'reading' };
  state = upsertWords(state, [reading, {id:'clumsy', word:'clumsy', meaning:'訳', sources:'reading'}]).state;
  assert.equal(state.words.length, 309);
  assert.equal(state.words[0].sources, 'ex|reading');
  assert.equal(state.records[0].wrongCount, 1);
  assert.equal(state.words.filter(word => matchesSource(word, 'ex')).length, 308);
  assert.equal(state.words.filter(word => matchesSource(word, 'reading')).length, 2);
  const legacyFeed = upsertWords(state, [{id:'clumsy',word:'clumsy',meaning:'別の訳'}]).state;
  assert.equal(legacyFeed.words[0].sources, 'ex|reading', 'old feed cannot erase provenance');
  assert.equal(legacyFeed.records[0].wrongCount, 1);
  assert.equal(upsertWords(legacyFeed, [reading]).state.words.length, 309);
});
test('old saved states and backups gain only seed EX labels without losing learning records', () => {
  let state = createState(initial);
  state.words = state.words.map(({sources, ...word}) => word);
  state.words.push({id:'reading-user',word:'reading-user',meaning:'学習語',range:'',active:true,updated_at:''});
  state = recordAnswer(state, 'clumsy', false);
  state = recordAnswer(state, 'clumsy', false);
  state = recordAnswer(state, 'clumsy', true);
  const store = memory({[STATE_KEY]: JSON.stringify({...state,legacyMigrated:true})});
  const loaded = initializeState(store, initial);
  assert.equal(loaded.words[0].sources, 'ex');
  assert.equal(loaded.words.at(-1).sources, '');
  assert.equal(loaded.records[0].wrongCount, 2);
  assert.equal(loaded.records[0].correctCount, 1);
  assert.deepEqual(initializeState(store, initial), loaded);
  const recovered = restoreBackup(createState(initial), state);
  assert.equal(recovered.records[0].wrongCount, 2);
  assert.equal(recovered.words.at(-1).sources, '');
});
test('source feed accepts optional column and multiple sources, rejects unknown codes', () => {
  assert.equal(normalizeSources('reading|ex|reading'), 'ex|reading');
  assert.equal(mergeSources('ex','reading'), 'ex|reading');
  const feed = 'id,word,meaning,range,active,updated_at,sources\\na,a,訳,,TRUE,,reading\\nb,b,訳,,TRUE,,ex|reading\\n';
  const rows = parseFeed(feed);
  assert.equal(rows[0].sources, 'reading');
  assert.equal(rows[1].sources, 'ex|reading');
  assert.equal(parseFeed('id,word,meaning\\na,a,訳\\n')[0].sources, '');
  for (const value of ['ex|other', 'reading,ex', 4, {}]) {
    assert.throws(() => normalizeSources(value));
  }
});
