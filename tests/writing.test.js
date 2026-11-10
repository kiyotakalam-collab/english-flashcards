import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../writing-core.js';
const DAY = 86400000, T = Date.parse('2026-01-01T00:00:00Z');
const question = (id = 'q1', tags = ['g1'], extra = {}) => ({ id, mode: 'short', prompt: '日本語を英語にしてください', grammar_tags: tags, difficulty: 'standard', source: 'original', reference_answers: ['One valid answer.'], explanation: '説明', japanese: '日本語', source_detail: '独自作成', active: true, created_at: new Date(T).toISOString(), updated_at: new Date(T).toISOString(), ...extra });
const questions = [question(), question('q2'), question('q3', ['g2'])];
const grammar = [{ id: 'g1', label: '文法1', important: true }, { id: 'g2', label: '文法2', important: false }];
const state = () => W.createState(questions);
const submit = (s, id = 'a1', q = 'q1', at = T, extra = {}) => W.submitAnswer(s, { id, questionId: q, input: 'My own answer.', ...extra }, at);
const grade = (s, id = 'a1', status = 'incorrect', at = T, extra = {}) => W.gradeAnswer(s, id, { status, ...extra }, at);
function memory(seed = {}) {
  const map = new Map(Object.entries(seed)), touched = [];
  return { map, touched, getItem(k) { touched.push(k); return map.get(k) ?? null; }, setItem(k, v) { touched.push(k); map.set(k, v); } };
}
test('independent storage initializes only confirmed first textbook item and no fabricated stats', () => {
  const storage = memory({ ex_flashcards_pwa_v2: 'vocab unchanged' });
  const s = W.initializeState(storage, questions);
  assert.equal(W.STATE_KEY, 'kotoba_writing_v1');
  assert.deepEqual(s.textbookProgress, { '構文80': { confirmedItems: [1] } });
  assert.ok(storage.touched.every(k => k === W.STATE_KEY));
  assert.equal(storage.map.get('ex_flashcards_pwa_v2'), 'vocab unchanged');
  assert.deepEqual(W.initializeState(storage, []), s);
  assert.equal(W.getGrammarStats(s, grammar, T)[0].mastery, null);
  assert.equal(W.getGrammarStats(s, grammar, T)[0].trend, null);
});
test('pure submit preserves independent snapshots, input, method and resubmission chain', () => {
  const original = state(), saved = JSON.stringify(original);
  let s = submit(original);
  s = grade(s);
  s = W.updateQuestion(s, 'q1', { prompt: 'Changed', custom_metadata: { teacher: 'A' } }, T);
  s = submit(s, 'a2', 'q1', T + DAY, { parentAnswerId: 'a1', method: 'self' });
  assert.equal(JSON.stringify(original), saved);
  assert.equal(s.answers[0].questionSnapshot.prompt, questions[0].prompt);
  assert.equal(s.answers[1].questionSnapshot.prompt, 'Changed');
  assert.equal(s.answers[1].parentAnswerId, 'a1'); assert.equal(s.answers[1].submissionCount, 2);
  assert.equal(s.answers[1].method, 'self'); assert.equal(s.answers[1].input, 'My own answer.');
  assert.throws(() => submit(s, 'a2'));
  assert.throws(() => submit(s, 'bad', 'q3', T, { parentAnswerId: 'a1' }));
  assert.throws(() => submit(s, 'blank', 'q1', T, { input: ' ' }));
});
test('no reference matching; pending never adds mistakes or changes review schedule', () => {
  let s = W.submitAnswer(state(), { id: 'a1', questionId: 'q1', input: questions[0].reference_answers[0] }, T);
  assert.equal(s.answers[0].evaluation.status, 'pending');
  assert.equal(W.getMistakeCount(s), 0); assert.equal(W.getReviewSchedule(s, 'q1').dueAt, null);
  s = grade(s, 'a1', 'correct'); const before = W.getReviewSchedule(s, 'q1');
  s = submit(s, 'a2', 'q1', T + DAY);
  assert.deepEqual(W.getReviewSchedule(s, 'q1'), before);
  assert.equal(W.getGrammarStats(s, grammar, T + DAY)[0].attempts, 1);
});
test('partial counts once; correction retains monotonic lifetime mistake and full audit', () => {
  let s = grade(submit(state()), 'a1', 'partial', T, { score: 5, errorCategories: ['tense'] });
  assert.equal(W.getMistakeCount(s), 1);
  s = grade(s, 'a1', 'incorrect', T + 1); s = grade(s, 'a1', 'correct', T + 2, { score: 10 });
  assert.equal(W.getMistakeCount(s), 1); assert.equal(s.answers[0].audit.length, 3);
  assert.equal(W.getReviewSchedule(s, 'q1').stage, 1);
  const identical = grade(s, 'a1', 'correct', T + 3, { score: 10 });
  assert.deepEqual(identical, s);
  s = grade(s, 'a1', 'incorrect', T + 4);
  assert.equal(W.getMistakeCount(s), 1);
  s = grade(submit(s, 'a2', 'q1', T + DAY), 'a2', 'incorrect', T + DAY);
  assert.equal(W.getMistakeCount(s), 2);
  assert.equal(W.validateState(s).answers[0].audit.length, 4);
});
test('short score bounds and essay rubric 4 × 5 are validated without exact grading', () => {
  const s = submit(state());
  assert.throws(() => grade(s, 'a1', 'correct', T, { score: 11 }));
  assert.throws(() => grade(s, 'a1', 'pending', T, { score: 0 }));
  assert.throws(() => grade(s, 'a1', 'unknown'));
  const essay = submit(W.createState([question('q1', ['g1'], { mode: 'essay' })]));
  const result = grade(essay, 'a1', 'partial', T, { rubric: { content: 4, organization: 3, grammar: 2, vocabulary: 5 } });
  assert.equal(result.answers[0].evaluation.score, 14); assert.equal(result.answers[0].evaluation.maxScore, 20);
  for (const rubric of [[5, 5, 5], [6, 5, 5, 5], [1.5, 2, 3, 4]]) assert.throws(() => grade(essay, 'a1', 'partial', T, { rubric }));
  assert.throws(() => grade(essay, 'a1', 'correct', T, { rubric: [5, 5, 5, 5], score: 19 }));
});
test('CRUD preserves full metadata; hide/delete retain answer snapshots and historical statistics', () => {
  let s = grade(submit(state()));
  s = W.upsertQuestion(s, question('user1', ['g1'], { source: 'past_exam_user', year: 2025, rubric_note: 'note' }), T);
  assert.equal(s.questions.at(-1).year, 2025);
  s = W.hideQuestion(s, 'q1', true, T);
  assert.ok(!W.getCandidates(s, grammar, { now: T }).some(q => q.id === 'q1'));
  s = W.hideQuestion(s, 'q1', false, T);
  s = W.deleteQuestion(s, 'q1', T);
  assert.equal(s.answers[0].questionSnapshot.deleted, undefined);
  assert.equal(W.getMistakeCount(s), 1);
  assert.throws(() => submit(s, 'a2'));
  assert.throws(() => W.upsertQuestion(s, question(), T));
  assert.equal(W.validateState(s).answers.length, 1);
});
test('review intervals 1/3/7/14/30 days and no same-day premature mastery', () => {
  let s = state(), at = T;
  for (let i = 0; i < 5; i++) {
    const id = `a${i}`;
    s = grade(submit(s, id, 'q1', at), id, 'correct', at);
    const review = W.getReviewSchedule(s, 'q1');
    assert.equal(review.stage, i + 1); assert.equal(Date.parse(review.dueAt) - at, W.REVIEW_DAYS[i] * DAY);
    assert.equal(review.mastered, i === 4); at = Date.parse(review.dueAt);
  }
  let fast = state();
  for (let i = 0; i < 8; i++) fast = grade(submit(fast, `fast${i}`, 'q1', T + i), `fast${i}`, 'correct', T + i);
  assert.equal(W.getReviewSchedule(fast, 'q1').stage, 1); assert.equal(W.getReviewSchedule(fast, 'q1').mastered, false);
  fast = grade(submit(fast, 'wrong', 'q1', T + 100), 'wrong', 'incorrect', T + 100);
  assert.equal(Date.parse(W.getReviewSchedule(fast, 'q1').dueAt), T + 100 + 600000);
  assert.equal(W.getReviewSchedule(fast, 'q1').stage, 0);
});
test('regrade earlier event replays subsequent schedule rather than double advancing', () => {
  let s = grade(submit(state()), 'a1', 'incorrect');
  s = grade(submit(s, 'a2', 'q1', T + DAY), 'a2', 'correct', T + DAY);
  assert.equal(W.getReviewSchedule(s, 'q1').stage, 1);
  s = grade(s, 'a1', 'correct', T + 2 * DAY);
  assert.equal(W.getReviewSchedule(s, 'q1').stage, 2);
  assert.equal(W.getMistakeCount(s), 1);
  s = grade(s, 'a1', 'pending', T + 3 * DAY);
  assert.equal(W.getReviewSchedule(s, 'q1').stage, 1);
});
test('adaptive ranking uses due, mistakes, accuracy, important unseen and diversity', () => {
  const initial = W.getCandidates(state(), grammar, { now: T });
  assert.ok(initial[0].reasons.includes('important_unseen'));
  const wrong = grade(submit(state()));
  const candidates = W.getCandidates(wrong, grammar, { now: T + DAY });
  assert.equal(candidates[0].id, 'q2'); assert.ok(candidates[0].reasons.includes('wrong_variant'));
  assert.ok(!candidates.some(q => q.id === 'q1'));
  const correct = grade(submit(state()), 'a1', 'correct');
  assert.equal(W.getCandidates(correct, grammar, { now: T })[0].id, 'q3');
  const reset = W.startSession(wrong, 'fresh');
  const due = W.getCandidates(reset, grammar, { now: T + DAY }).find(q => q.id === 'q1');
  for (const reason of ['due', 'recent_mistake', 'low_accuracy']) assert.ok(due.reasons.includes(reason));
});
test('defer excludes throughout current session and resets only with new session', () => {
  let s = W.deferQuestion(state(), 'q1');
  assert.ok(!W.getCandidates(s, grammar, { now: T + 100 * DAY }).some(q => q.id === 'q1'));
  s = W.startSession(s, 'new'); assert.ok(W.getCandidates(s, grammar, { now: T }).some(q => q.id === 'q1'));
});
test('textbook progress is never an exercise candidate even when confirmed', () => {
  const s = W.createState([1, 2, 3].map(n => question(`text${n}`, ['g1'], { source: 'textbook_progress', textbook_item: n })));
  assert.deepEqual(W.getCandidates(s, grammar, { now: T }), []);
  const updated = W.setTextbookProgress(s, '構文80', [1, 3]);
  assert.deepEqual(W.getCandidates(updated, grammar, { now: T }), []);
  assert.throws(() => submit(updated, 'x', 'text1'));
  assert.deepEqual(s.textbookProgress['構文80'].confirmedItems, [1]);
});
test('stats use difficulty, actual observations, recency and evidence confidence', () => {
  let s = grade(submit(state()), 'a1', 'incorrect');
  s = W.updateQuestion(s, 'q2', { difficulty: 'keio' }, T);
  s = grade(submit(s, 'a2', 'q2', T + DAY), 'a2', 'correct', T + DAY);
  const stats = W.getGrammarStats(s, grammar, T + DAY)[0];
  assert.equal(stats.attempts, 2); assert.equal(stats.accuracy, .5); assert.equal(stats.trend, 1);
  assert.ok(stats.weightedScore > .5); assert.ok(stats.mastery < stats.weightedScore); assert.equal(stats.mastered, false);
  assert.equal(stats.observations.length, 2);
  assert.ok(W.getGrammarStats(s, grammar, T + 100 * DAY)[0].confidence < stats.confidence);
});
test('drafts/settings/session roundtrip and submit clears only its own draft', () => {
  let s = W.saveDraft(W.saveDraft(state(), 'q1', 'first'), 'q2', 'other');
  s = W.updateSettings(W.startSession(s, 'session1'), { mode: 'all', difficulty: 'keio', custom: 'kept' });
  s = W.deferQuestion(submit(s), 'q3');
  const restored = W.validateState(JSON.parse(W.exportBackup(s)));
  assert.deepEqual(restored, s); assert.deepEqual(restored.drafts, { q2: 'other' });
  assert.equal(restored.session.id, 'session1'); assert.equal(restored.settings.custom, 'kept');
});
test('backup merges deduplicate events and audit prefixes without inflating mistakes', () => {
  const old = grade(submit(state()));
  const corrected = grade(old, 'a1', 'correct', T + 1);
  let s = W.importBackup(old, W.exportBackup(corrected));
  assert.equal(s.answers[0].evaluation.status, 'correct'); assert.equal(W.getMistakeCount(s), 1);
  assert.deepEqual(W.importBackup(s, old), s); assert.deepEqual(W.importBackup(s, corrected), s);
  const other = grade(submit(state(), 'a2', 'q2'), 'a2', 'partial');
  s = W.importBackup(s, other); assert.equal(W.getMistakeCount(s), 2);
  assert.deepEqual(W.importBackup(s, other), s);
});
test('conflicting questions, answer identities and divergent grades reject atomically', () => {
  const s = grade(submit(state())), snapshot = JSON.stringify(s);
  const changedQuestion = W.updateQuestion(s, 'q1', { prompt: 'different' }, T);
  assert.throws(() => W.importBackup(s, changedQuestion), /conflict/i);
  const altered = structuredClone(s); altered.answers[0].input = 'different';
  assert.throws(() => W.importBackup(s, altered), /conflict/i);
  const forkA = grade(s, 'a1', 'correct', T + 1), forkB = grade(s, 'a1', 'partial', T + 2);
  assert.throws(() => W.importBackup(forkA, forkB), /conflict/i);
  assert.equal(JSON.stringify(s), snapshot);
});
test('validation rejects corrupt versions, counts, audit, parents, unsafe JSON and conflicting duplicates', () => {
  const original = grade(submit(state()));
  const changes = [s => s.version = 2, s => s.revision = -1, s => s.answers[0].submissionCount = 0,
    s => s.answers[0].mistakeCounted = false, s => s.answers[0].audit = [], s => s.answers[0].parentAnswerId = 'a1',
    s => s.questions.push({ ...s.questions[0], prompt: 'conflict' }), s => s.session.deferredQuestionIds = 'q1',
    s => s.answers[0].evaluation.score = 999];
  for (const change of changes) { const s = structuredClone(original); change(s); assert.throws(() => W.validateState(s)); }
  assert.throws(() => W.validateState(JSON.parse('{"__proto__":{},"version":1}')));
  const identical = structuredClone(original); identical.answers.push(structuredClone(identical.answers[0]));
  assert.equal(W.validateState(identical).answers.length, 1);
  const schedule = structuredClone(original); schedule.answers[0].reviewSchedule = { mastered: true };
  assert.equal(W.validateState(schedule).answers[0].reviewSchedule.mastered, false);
});
test('malformed storage is preserved and stale revisions never overwrite current state', () => {
  const corrupt = memory({ [W.STATE_KEY]: '{broken' });
  assert.throws(() => W.initializeState(corrupt, questions)); assert.equal(corrupt.map.get(W.STATE_KEY), '{broken');
  const storage = memory(); const s = W.initializeState(storage, questions);
  const saved = W.saveState(storage, s, { expectedRevision: 0 }); assert.equal(saved.revision, 1);
  assert.throws(() => W.saveState(storage, s, { expectedRevision: 0 }), /conflict/i);
  assert.equal(JSON.parse(storage.map.get(W.STATE_KEY)).revision, 1);
});
test('transactions prefer Web Locks and fallback serializes concurrent updates', async () => {
  const storage = memory(); let locked = 0;
  const locks = { async request(name, options, callback) { assert.equal(name, W.STATE_KEY); assert.equal(options.mode, 'exclusive'); locked++; return callback(); } };
  await W.transact(storage, s => W.saveDraft(s, 'q1', 'locked'), { questions, locks }); assert.equal(locked, 1);
  await Promise.all(Array.from({ length: 10 }, (_, i) => W.transact(storage, s => W.updateSettings(s, { counter: (s.settings.counter ?? 0) + 1 }), { locks: null })));
  const restored = W.initializeState(storage); assert.equal(restored.settings.counter, 10); assert.equal(restored.revision, 11);
  await assert.rejects(W.transact(storage, () => { throw new Error('abort'); }, { locks: null }));
  await W.transact(storage, s => W.saveDraft(s, 'q2', 'after failure'), { locks: null });
  assert.equal(W.initializeState(storage).drafts.q2, 'after failure');
  await assert.rejects(W.transact(storage, async s => s, { locks: null }), /synchronous/);
});

test('structured feedback persists through grading, audit and backup', () => {
  const feedback = { grammarErrors: [{ text: 'go', correction: 'went' }], meaning: 'preserved', naturalness: 'revise', improved: 'I went.', reason: 'past event', correctParts: ['subject'], confidence: .7 };
  const s = grade(submit(state()), 'a1', 'partial', T, feedback);
  const restored = W.validateState(JSON.parse(W.exportBackup(s)));
  for (const [k,v] of Object.entries(feedback)) { assert.deepEqual(restored.answers[0].evaluation[k], v); assert.deepEqual(restored.answers[0].audit[0].evaluation[k], v); }
});
test('fresh seeded device restores edited, hidden and deleted newer originals idempotently', () => {
  let edited = grade(submit(state()));
  edited = W.updateQuestion(edited, 'q1', { japanese: '修正版' }, T + DAY);
  edited = W.hideQuestion(edited, 'q2', true, T + DAY);
  edited = W.deleteQuestion(edited, 'q3', T + DAY);
  const restored = W.importBackup(state(), W.exportBackup(edited));
  assert.equal(restored.questions[0].japanese, '修正版'); assert.equal(restored.questions[1].active, false);
  assert.equal(restored.questions[2].deleted, true); assert.equal(restored.answers[0].questionSnapshot.japanese, '日本語');
  assert.deepEqual(W.importBackup(restored, edited), restored); assert.deepEqual(W.importBackup(restored, state()), restored);
});
test('required question metadata, JST calendar and review states', () => {
  for (const k of ['japanese','source_detail','explanation','created_at','updated_at','active']) { const q = question(); delete q[k]; assert.throws(() => W.createState([q])); }
  assert.equal(W.getJstDayKey('2026-01-01T15:00:00Z'), '2026-01-02');
  assert.equal(W.getReviewState(state(), 'q1', T), 'unpracticed');
  const pending = submit(state()); assert.equal(W.getReviewState(pending, 'q1', T), 'checking');
  const correct = grade(pending, 'a1', 'correct'); assert.equal(W.getReviewState(correct, 'q1', T), 'waiting');
  assert.equal(W.getReviewState(correct, 'q1', T + DAY), 'due');
  assert.equal(W.getReviewState(grade(pending), 'q1', T), 'relearn');
  assert.deepEqual(W.getCandidates(W.deferQuestion(state(), 'q1'), grammar, { now: T }).map(q => q.id), ['q3']);
});
test('unsafe IDs cannot inject UI attributes, and repeated grading keeps one historical mistake',()=>{
 const q=question();q.id='x" autofocus onfocus="alert(1)';assert.throws(()=>W.createState([q]));
 const s=grade(submit(state()));
 const again=W.gradeAnswer(s,'a1',s.answers[0].evaluation,T+DAY);
 assert.equal(again.answers.length,1);assert.equal(W.getMistakeCount(again),1);
 assert.equal(again.answers[0].audit.length,s.answers[0].audit.length);
 const malicious=state();malicious.session.position='<img src=x onerror=alert(1)>';assert.throws(()=>W.validateState(malicious));
 assert.throws(()=>W.updateSettings(state(),{strategy:'invented-strategy'}));
});
