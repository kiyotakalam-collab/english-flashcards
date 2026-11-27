import { CATEGORIES, INITIAL_ITEMS } from './usage-data.js';
export const STATE_KEY = 'kotoba_usage_v1';
const clone = value => structuredClone(value);
const uid = () => crypto.randomUUID();
const instant = () => new Date().toISOString();
const fail = message => { throw new Error(message); };
const string = (v, name, limit = 500) => typeof v === 'string' && v.trim() && v.length <= limit ? v.trim() : fail(`${name}を入力してください（${limit}文字以内）。`);
const validDate = date => typeof date === 'string' && Number.isFinite(Date.parse(date));

/** Ignore presentation only: keep internal punctuation, inflections and every preposition. */
export function normalizeAnswer(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\.+$/, '').trim().replace(/\s+/gu, ' ').toLowerCase();
}
const variable = token => /^(?:[abc]|[~〜～…_]+|人|もの|物|誰か|何か|someone|somebody|something|sb\.?|sth\.?)$/iu.test(token);
function tokens(value) { return String(value).normalize('NFKC').trim().replace(/\.+$/, '').trim().replace(/([~〜～…]+)/gu, ' $1 ').split(/\s+/u).filter(Boolean); }
function isSlot(token) { return /^[ABC]$/.test(token) || (variable(token) && !/^[abc]$/i.test(token)); }
export function gradeAnswer(answer, reference) {
  const entered = tokens(answer), expected = tokens(reference);
  if (!entered.length || entered.length !== expected.length) return false;
  return expected.every((token, i) => isSlot(token) ? variable(entered[i]) : token.toLowerCase() === entered[i].toLowerCase());
}
export function duplicateExpression(a, b) {
  // Test both directions so a different placeholder notation cannot bypass registration checks.
  return gradeAnswer(a, b) || gradeAnswer(b, a);
}
function validateItem(row) {
  string(row?.id, 'ID', 150); string(row.Japanese, '日本語'); string(row.English, '英語'); string(row.example, '例文', 1000);
  if (!CATEGORIES.includes(row.category) || typeof row.active !== 'boolean' || !validDate(row.created_at) || !validDate(row.updated_at)) fail('語法データが不正です。');
}
export function validateState(state) {
  if (state?.schemaVersion !== 1 || !Array.isArray(state.items) || state.items.length > 10000 || !Array.isArray(state.attempts) || !Array.isArray(state.tests) || !state.settings) fail('語法の保存データを読み取れません。初期化せずに中止しました。');
  const ids = new Set();
  for (const item of state.items) { validateItem(item); if (ids.has(item.id)) fail('語法IDが重複しています。'); ids.add(item.id); }
  const attemptIds = new Set();
  for (const a of state.attempts) {
    if (!a || typeof a.id !== 'string' || attemptIds.has(a.id) || typeof a.correct !== 'boolean' || typeof a.answer !== 'string' || !validDate(a.answeredAt) || !['test', 'review'].includes(a.mode)) fail('回答履歴が不正です。');
    validateItem(a.snapshot); attemptIds.add(a.id);
  }
  const testIds = new Set();
  for (const t of state.tests) {
    if (!t || typeof t.id !== 'string' || testIds.has(t.id) || !Array.isArray(t.questions) || !t.questions.length || !Array.isArray(t.wrongIds) || !Array.isArray(t.reviewRemainingIds) || !Array.isArray(t.attemptIds) || !validDate(t.startedAt)) fail('テスト履歴が不正です。');
    t.questions.forEach(validateItem); const qids = new Set(t.questions.map(q => q.id));
    if (qids.size !== t.questions.length || t.wrongIds.some(id => !qids.has(id)) || t.reviewRemainingIds.some(id => !t.wrongIds.includes(id)) || t.attemptIds.some(id => !attemptIds.has(id))) fail('復習セットが不正です。');
    testIds.add(t.id);
  }
  const s = state.session;
  if (s) {
    if (!testIds.has(s.testId) || typeof s.id !== 'string' || !['test', 'review'].includes(s.mode) || !['answer', 'feedback', 'complete'].includes(s.phase) || !Array.isArray(s.queue) || !s.queue.length || !Number.isInteger(s.index) || s.index < 0 || s.index >= s.queue.length || typeof s.draft !== 'string') fail('演習の保存データが不正です。');
    const test = state.tests.find(t => t.id === s.testId), qids = new Set(test.questions.map(q => q.id));
    if (s.queue.some(id => !qids.has(id)) || (s.phase === 'feedback' && !attemptIds.has(s.feedbackAttemptId))) fail('回答中の問題を読み取れません。');
  }
  return state;
}
export function initialState() { return { schemaVersion: 1, items: clone(INITIAL_ITEMS), attempts: [], tests: [], session: null, settings: { count: '10', category: 'all' } }; }
export function readState(storage) {
  const raw = storage.getItem(STATE_KEY);
  return raw === null ? initialState() : validateState(JSON.parse(raw));
}
export function initializeState(storage) {
  const state = readState(storage);
  if (storage.getItem(STATE_KEY) === null) storage.setItem(STATE_KEY, JSON.stringify(state));
  return state;
}
export async function transact(storage, operation) {
  const write = () => { const next = validateState(operation(readState(storage))); storage.setItem(STATE_KEY, JSON.stringify(next)); return next; };
  return globalThis.navigator?.locks ? navigator.locks.request(STATE_KEY, write) : write();
}
export function shuffle(values, rng = Math.random) {
  const rows = [...values]; for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; } return rows;
}
export function startTest(state, { count = '10', category = 'all', now = instant(), id = uid(), rng = Math.random } = {}) {
  if (!['10', '20', '30', 'all'].includes(String(count)) || (category !== 'all' && !CATEGORIES.includes(category))) fail('出題設定が不正です。');
  const pool = state.items.filter(item => item.active && (category === 'all' || item.category === category));
  if (!pool.length) fail('このカテゴリーに出題できる語法がありません。');
  const questions = clone(shuffle(pool, rng).slice(0, count === 'all' ? pool.length : Number(count)));
  const next = clone(state);
  const test = { id, questions, startedAt: now, completedAt: null, wrongIds: [], reviewRemainingIds: [], attemptIds: [], reviewCompletedAt: null };
  next.tests.push(test); next.settings = { ...next.settings, count: String(count), category };
  next.session = { id, testId: id, mode: 'test', queue: questions.map(q => q.id), index: 0, phase: 'answer', draft: '', feedbackAttemptId: null };
  return next;
}
export function currentQuestion(state) {
  const s = state.session; return s && state.tests.find(t => t.id === s.testId)?.questions.find(q => q.id === s.queue[s.index]);
}
export function saveDraft(state, text, sessionId, index) {
  const next = clone(state), s = next.session;
  if (s?.id === sessionId && s.index === index && s.phase === 'answer') s.draft = String(text).slice(0, 1000);
  return next;
}
export function submitAnswer(state, answer, { sessionId, index, now = instant() } = {}) {
  const s = state.session;
  if (!s || s.phase !== 'answer' || s.id !== sessionId || s.index !== index) return clone(state);
  const text = string(answer, '回答', 1000), next = clone(state), session = next.session;
  const question = currentQuestion(next), test = next.tests.find(t => t.id === session.testId), correct = gradeAnswer(text, question.English);
  const id = `${session.id}:${session.index}`;
  if (next.attempts.some(a => a.id === id)) return next;
  next.attempts.push({ id, testId: test.id, itemId: question.id, snapshot: clone(question), answer: text, correct, answeredAt: now, mode: session.mode });
  if (session.mode === 'test') {
    test.attemptIds.push(id);
    if (!correct) { test.wrongIds.push(question.id); test.reviewRemainingIds.push(question.id); }
  } else if (correct) test.reviewRemainingIds = test.reviewRemainingIds.filter(id => id !== question.id);
  session.phase = 'feedback'; session.feedbackAttemptId = id; session.draft = text;
  return next;
}
export function nextQuestion(state, { sessionId, index, now = instant(), rng = Math.random } = {}) {
  const next = clone(state), s = next.session;
  if (!s || s.id !== sessionId || s.index !== index || s.phase !== 'feedback') return next;
  const test = next.tests.find(t => t.id === s.testId);
  if (s.index + 1 < s.queue.length) s.index++;
  else if (s.mode === 'review' && test.reviewRemainingIds.length) {
    // Extend instead of resetting index: attempt IDs remain unique across review rounds.
    s.queue.push(...shuffle(test.reviewRemainingIds, rng)); s.index++;
  } else {
    s.phase = 'complete';
    if (s.mode === 'test') test.completedAt = now; else test.reviewCompletedAt = now;
    return next;
  }
  s.phase = 'answer'; s.draft = ''; s.feedbackAttemptId = null; return next;
}
export function startReview(state, { id = uid(), rng = Math.random } = {}) {
  const next = clone(state), test = next.tests.at(-1);
  if (!test?.completedAt || !test.reviewRemainingIds.length) fail('今回のテストに未解決の誤答はありません。');
  next.session = { id, testId: test.id, mode: 'review', queue: shuffle(test.reviewRemainingIds, rng), index: 0, phase: 'answer', draft: '', feedbackAttemptId: null };
  return next;
}
export function saveItem(state, data, { id = uid(), now = instant() } = {}) {
  const next = clone(state), existing = data.id ? next.items.find(row => row.id === data.id) : null;
  if (data.id && !existing) fail('編集する語法が見つかりません。');
  const item = { id: existing?.id || id, Japanese: string(data.Japanese, '日本語'), English: string(data.English, '英語'), example: string(data.example, '例文', 1000), category: data.category, active: data.active ?? true, created_at: existing?.created_at || now, updated_at: now };
  validateItem(item);
  if (next.items.some(row => row.id !== item.id && duplicateExpression(row.English, item.English))) fail('同じ語法がすでに登録されています。非表示の語法も確認してください。');
  if (existing) next.items[next.items.findIndex(row => row.id === item.id)] = item; else next.items.push(item);
  return next;
}
export function itemStats(state, id) {
  const rows = state.attempts.filter(a => a.itemId === id); return { attempts: rows.length, wrong: rows.filter(a => !a.correct).length, correct: rows.filter(a => a.correct).length };
}
export function exportBackup(state) { return { format: 'kotoba-usage-backup', version: 1, exportedAt: instant(), state: clone(validateState(state)) }; }
export function restoreBackup(state, backup) {
  if (backup?.format !== 'kotoba-usage-backup' || backup.version !== 1) fail('語法マスター専用のJSONを選択してください。');
  const incoming = validateState(clone(backup.state)), next = clone(state);
  // An exact saved state may be imported repeatedly; never count an answer twice.
  for (const item of incoming.items) {
    const existing = next.items.find(row => row.id === item.id);
    if (!existing && next.items.some(row => duplicateExpression(row.English, item.English))) fail('別IDで同じ語法が存在するため取り込めません。');
    if (!existing) next.items.push(item);
    else if (item.updated_at > existing.updated_at) Object.assign(existing, item);
  }
  for (const attempt of incoming.attempts) {
    const existing = next.attempts.find(row => row.id === attempt.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(attempt)) fail('同じ回答IDに異なる履歴があります。取り込まずに中止しました。');
    if (!existing) next.attempts.push(attempt);
  }
  for (const test of incoming.tests) {
    const existing = next.tests.find(row => row.id === test.id);
    if (!existing) next.tests.push(test);
    else {
      if (JSON.stringify(existing.questions) !== JSON.stringify(test.questions)) fail('同じテストIDに異なる問題があります。');
      const local = new Set(state.attempts.filter(a => a.testId === test.id).map(a => a.id));
      const imported = new Set(incoming.attempts.filter(a => a.testId === test.id).map(a => a.id));
      const hasNew = [...imported].some(id => !local.has(id));
      if (hasNew) {
        if ([...local].some(id => !imported.has(id))) fail('同じテストから異なる復習履歴が分岐しています。取り込まずに中止しました。');
        Object.assign(existing, test);
        if (next.session?.testId === test.id && incoming.session?.testId === test.id) next.session = incoming.session;
      }
    }
  }
  next.tests.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (!next.session && incoming.session) next.session = incoming.session;
  for (let i = 0; i < next.items.length; i++) for (let j = 0; j < i; j++) if (duplicateExpression(next.items[i].English, next.items[j].English)) fail('取り込み後の語法が重複するため中止しました。');
  return validateState(next);
}
