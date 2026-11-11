/** Independent writing domain. No vocabulary storage or question-data imports.
 * All state operations are pure. Pass ISO time (or milliseconds) for deterministic use.
 * Partial/incorrect count one lifetime mistake per answer ID; corrections retain audit.
 * UI: submitAnswer creates pending events; gradeAnswer is explicit manual assessment.
 * transact is the persistence boundary; Web Locks serialize tabs when available.
 */
export const STATE_KEY = 'kotoba_writing_v1';
export const VERSION = 1;
export const REVIEW_DAYS = Object.freeze([1, 3, 7, 14, 30]);
export const DIFFICULTIES = Object.freeze(['basic', 'standard', 'advanced', 'keio']);
export const SOURCES = Object.freeze(['original', 'user', 'textbook_progress', 'past_exam_user']);
export const GRADES = Object.freeze(['correct', 'partial', 'incorrect', 'pending']);
const DAY = 86400000;
const copy = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const str = (v, field) => typeof v === 'string' && v.trim() && !['__proto__', 'constructor', 'prototype'].includes(v.trim()) ? v.trim() : fail(`Invalid ${field}`);
const identifier = (v, field) => {
  const value=str(v,field);
  if(value.length>180||!/^[-\p{L}\p{N}_.:]+$/u.test(value))fail(`Invalid ${field}: IDには文字・数字・ハイフン等を使用してください。`);
  return value;
};
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const time = (v = Date.now()) => {
  const n = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(n)) fail('Invalid time');
  return new Date(n).toISOString();
};
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const equal = (a, b) => canonical(a) === canonical(b);
function canonical(v) {
  if (Array.isArray(v)) return JSON.stringify(v.map(x => JSON.parse(canonical(x))));
  if (v && typeof v === 'object') return JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(canonical(v[k]))])));
  return JSON.stringify(v);
}
function jsonSafe(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return;
  if (Array.isArray(v)) { v.forEach(jsonSafe); return; }
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) fail('Expected JSON data');
  for (const [k, x] of Object.entries(v)) {
    if (['__proto__', 'prototype', 'constructor'].includes(k)) fail('Unsafe property');
    jsonSafe(x);
  }
}
function unique(rows, label) {
  if (!Array.isArray(rows) || rows.length > 100000) fail(`Invalid ${label}`);
  const map = new Map();
  for (const row of rows) {
    const id = identifier(row?.id, `${label} id`);
    if (map.has(id) && !equal(map.get(id), row)) fail(`Conflicting ${label} ID: ${id}`);
    map.set(id, copy(row));
  }
  return [...map.values()];
}
export function validateQuestion(row) {
  jsonSafe(row);
  const q = copy(row);
  q.id = identifier(q.id, 'question id');
  if (!['short', 'essay'].includes(q.mode) || !DIFFICULTIES.includes(q.difficulty) || !SOURCES.includes(q.source)) fail('Invalid question mode/difficulty/source');
  if (typeof q.active !== 'boolean') fail('Question active must be boolean');
  for (const k of ['japanese', 'source_detail', 'explanation']) str(q[k], k);
  for (const k of ['created_at', 'updated_at']) { str(q[k], k); time(q[k]); }
  if (Date.parse(q.updated_at) < Date.parse(q.created_at)) fail('Question update predates creation');
  // Preserve the full authored field list, including textbook/copyright metadata.
  if (!['prompt', 'text', 'question', 'japanese', 'title'].some(k => typeof q[k] === 'string' && q[k].trim())) fail('Question prompt required');
  if (!Array.isArray(q.grammar_tags) || q.grammar_tags.some(t => typeof t !== 'string' || !t.trim()) || new Set(q.grammar_tags).size !== q.grammar_tags.length) fail('Invalid grammar tags');
  q.grammar_tags.forEach(tag=>identifier(tag,'grammar tag'));
  if (!Array.isArray(q.reference_answers) || q.reference_answers.some(v => typeof v !== 'string')) fail('Invalid reference answers');
  for (const k of ['hidden', 'deleted']) if (q[k] !== undefined && typeof q[k] !== 'boolean') fail(`Invalid ${k}`);
  return q;
}
export function createState(questions = []) {
  return {
    version: VERSION, revision: 0, questions: unique(questions.map(validateQuestion), 'questions'), answers: [],
    textbookProgress: { '構文80': { confirmedItems: [1] } },
    drafts: {}, session: { id: null, deferredQuestionIds: [], answeredQuestionIds: [], lastAnswerId: null },
    settings: { gradingMethod: 'manual', mode: 'short', difficulty: 'standard' }
  };
}
function requireQuestion(s, id) { return s.questions.find(q => q.id === id) ?? fail('Question not found'); }
function requireAnswer(s, id) { return s.answers.find(a => a.id === id) ?? fail('Answer not found'); }
export function upsertQuestion(state, question, now = Date.now()) {
  const q = validateQuestion(question), s = copy(state), old = s.questions.find(x => x.id === q.id);
  if (old?.deleted) fail('Deleted question ID cannot be reused');
  const next = validateQuestion({ ...q, updated_at: time(now) });
  if (old) s.questions[s.questions.indexOf(old)] = next; else s.questions.push(next);
  return s;
}
export const addQuestion = upsertQuestion;
export function updateQuestion(state, id, patch, now) {
  if (patch.id !== undefined && patch.id !== id) fail('Question ID is immutable');
  return upsertQuestion(state, { ...requireQuestion(state, id), ...patch, id }, now);
}
export function hideQuestion(state, id, hidden = true, now) { return updateQuestion(state, id, { hidden, active: !hidden }, now); }
export function deleteQuestion(state, id, now) { return updateQuestion(state, id, { deleted: true, hidden: true, active: false }, now); }
export function setTextbookProgress(state, book, confirmedItems) {
  str(book, 'book');
  if (['__proto__', 'constructor', 'prototype'].includes(book) || !Array.isArray(confirmedItems) || confirmedItems.some(n => !integer(n, 1))) fail('Invalid confirmed progress');
  const s = copy(state);
  s.textbookProgress[book] = { confirmedItems: [...new Set(confirmedItems)].sort((a, b) => a - b) };
  return s;
}
export function saveDraft(state, questionId, input) {
  requireQuestion(state, questionId);
  if (typeof input !== 'string') fail('Invalid draft');
  const s = copy(state); s.drafts[questionId] = input; return s;
}
export function updateSettings(state, patch) {
  jsonSafe(patch);
  const s = copy(state); s.settings = { ...s.settings, ...copy(patch) };
  if (!['short', 'essay', 'all'].includes(s.settings.mode) || !DIFFICULTIES.includes(s.settings.difficulty) || s.settings.gradingMethod !== 'manual') fail('Unsupported settings');
  validateSettings(s.settings);
  return s;
}
function validateSettings(settings) {
 if(settings.limit!==undefined&&![0,5,10,20].includes(settings.limit))fail('Invalid session limit');
 if(settings.strategy!==undefined&&!['adaptive','grammar','weak','new','review','random','ai'].includes(settings.strategy))fail('Invalid question strategy');
 if(settings.theme!==undefined&&!['light','dark'].includes(settings.theme))fail('Invalid theme');
 if(settings.minutes!==undefined&&(!integer(settings.minutes)||settings.minutes>240))fail('Invalid time limit');
 if(settings.grammar)identifier(settings.grammar,'grammar filter');
}
export function startSession(state, id = uid('session')) {
  const s = copy(state); s.session = { id: str(id, 'session id'), deferredQuestionIds: [], answeredQuestionIds: [], lastAnswerId: null }; return s;
}
export function updateSession(state, patch) {
  jsonSafe(patch); const s = copy(state); s.session = { ...s.session, ...copy(patch) }; return validateState(s);
}
export function deferQuestion(state, questionId) {
  const q = requireQuestion(state, questionId), s = copy(state);
  const ids = s.questions.filter(x => x.id === questionId || x.grammar_tags.some(t => q.grammar_tags.includes(t))).map(x => x.id);
  s.session.deferredQuestionIds = [...new Set([...s.session.deferredQuestionIds, ...ids])]; return s;
}
const emptySchedule = () => ({ stage: 0, dueAt: null, lastReviewedAt: null, lastResult: null, mastered: false, successfulDays: [] });
/** Replays current evaluations, so regrading an older event safely rebuilds review. */
function advanceSchedule(result, a) {
    const status = a.evaluation.status;
    if (status === 'pending') return result;
    const at = a.submittedAt, date = getJstDayKey(at);
    if (status !== 'correct') {
      result = { stage: 0, dueAt: time(Date.parse(at) + 10 * 60000), lastReviewedAt: at, lastResult: status, mastered: false, successfulDays: [] };
    } else {
      const eligible = result.lastResult !== 'correct' || (result.dueAt && at >= result.dueAt);
      const stage = eligible ? Math.min(result.stage + 1, REVIEW_DAYS.length) : result.stage;
      const days = [...new Set([...result.successfulDays, date])];
      result = { stage, dueAt: eligible ? time(Date.parse(at) + REVIEW_DAYS[Math.max(stage - 1, 0)] * DAY) : result.dueAt,
        lastReviewedAt: at, lastResult: status, mastered: stage === 5 && days.length >= 5, successfulDays: days };
    }
  return result;
}
export function getReviewSchedule(state, questionId) {
  return state.answers.filter(a => a.questionId === questionId)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id))
    .reduce(advanceSchedule, emptySchedule());
}
function refreshSchedules(s) {
  const schedules = new Map();
  for (const a of [...s.answers].sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt)||a.id.localeCompare(b.id))) {
    const next=advanceSchedule(schedules.get(a.questionId)||emptySchedule(),a);
    schedules.set(a.questionId,next);
    a.reviewSchedule=copy(next);
  }
  return s;
}
export function submitAnswer(state, options, now = Date.now()) {
  const q = requireQuestion(state, options.questionId);
  if (!q.active || q.hidden || q.deleted || q.source === 'textbook_progress') fail('Question unavailable');
  const id = options.id ?? uid('answer'); str(id, 'answer id');
  if (state.answers.some(a => a.id === id)) fail('Answer ID already exists');
  if (typeof options.input !== 'string' || !options.input.trim()) fail('Answer input required');
  const method = options.method ?? 'manual';
  if (!['manual', 'self', 'ai'].includes(method)) fail('Invalid method');
  const parentAnswerId = options.parentAnswerId ?? null;
  if (parentAnswerId && requireAnswer(state, parentAnswerId).questionId !== q.id) fail('Parent must refer to same question');
  const s = copy(state), submittedAt = time(now);
  const a = { id, questionId: q.id, questionSnapshot: copy(q), input: options.input, method, submittedAt,
    submissionCount: s.answers.filter(x => x.questionId === q.id).length + 1, parentAnswerId,
    resubmissionCount: parentAnswerId ? (requireAnswer(s,parentAnswerId).resubmissionCount||0)+1 : 0,
    evaluation: { status: 'pending', score: null, maxScore: q.mode === 'short' ? 10 : 20, rubric: null, errorCategories: [], feedback: '' },
    errorCategories: [], mistakeCounted: false, audit: [], reviewSchedule: getReviewSchedule(state, q.id) };
  s.answers.push(a); delete s.drafts[q.id];
  s.session.lastAnswerId = id;
  s.session.answeredQuestionIds = [...new Set([...s.session.answeredQuestionIds, q.id])];
  return s;
}
function evaluation(input, mode) {
  jsonSafe(input);
  const status = input.status;
  if (!GRADES.includes(status)) fail('Invalid grade');
  const maxScore = mode === 'essay' ? 20 : 10;
  let rubric = input.rubric ?? null, score = input.score ?? null;
  if (rubric !== null) {
    const values = Array.isArray(rubric) ? rubric : Object.values(rubric);
    if (mode !== 'essay' || values.length !== 4 || values.some(x => !integer(x, 0, 5))) fail('Essay rubric requires four 0–5 scores');
    const sum = values.reduce((a, b) => a + b, 0);
    if (score !== null && score !== sum) fail('Rubric total disagrees with score');
    score = sum;
  }
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > maxScore)) fail('Invalid score');
  if (status === 'pending' && (score !== null || rubric !== null)) fail('Pending grade cannot have score');
  const errorCategories = input.errorCategories ?? [];
  if (!Array.isArray(errorCategories) || errorCategories.some(x => typeof x !== 'string' || !x.trim())) fail('Invalid error categories');
  if (input.feedback !== undefined && typeof input.feedback !== 'string') fail('Invalid feedback');
  const result = { status, score, maxScore, rubric: copy(rubric), errorCategories: [...new Set(errorCategories)], feedback: input.feedback ?? '' };
  for (const key of ['grammarErrors', 'meaning', 'naturalness', 'improved', 'reason', 'correctParts', 'confidence']) {
    if (input[key] !== undefined) result[key] = copy(input[key]);
  }
  for (const key of ['improved','reason']) if(result[key]!==undefined&&typeof result[key]!=='string') fail(`Invalid ${key}`);
  if (result.confidence !== undefined && result.confidence !== null && (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1)) fail('Invalid confidence');
  return result;
}
export function gradeAnswer(state, answerId, grade, now = Date.now()) {
  const s = copy(state), a = requireAnswer(s, answerId), next = evaluation(grade, a.questionSnapshot.mode);
  if (equal(a.evaluation, next)) return s;
  const at = time(now);
  if (at < a.submittedAt || (a.audit.length && at < a.audit.at(-1).at)) fail('Grade predates answer/audit');
  a.audit.push({ id: grade.auditId ?? uid('grade'), at, previous: copy(a.evaluation), evaluation: copy(next) });
  a.evaluation = next; a.errorCategories = [...next.errorCategories];
  a.mistakeCounted ||= ['incorrect', 'partial'].includes(next.status);
  return refreshSchedules(s);
}
export function getMistakeCount(state, questionId) { return state.answers.filter(a => a.mistakeCounted && (!questionId || a.questionId === questionId)).length; }
export function getCandidates(state, grammar = [], { now = Date.now(), mode = state.settings.mode, difficulty, source } = {}) {
  const at = time(now), important = new Set(grammar.filter(g => g.important).map(g => g.id));
  const last = state.answers.find(a => a.id === state.session.lastAnswerId);
  let rows = state.questions.filter(q => q.active && q.source !== 'textbook_progress' && !q.hidden && !q.deleted && !state.session.deferredQuestionIds.includes(q.id)
    && (!mode || mode === 'all' || q.mode === mode) && (!difficulty || q.difficulty === difficulty) && (!source || q.source === source))
    .map(q => {
      const events = state.answers.filter(a => a.questionId === q.id && a.evaluation.status !== 'pending');
      const schedule = getReviewSchedule(state, q.id), recent = events.at(-1), reasons = [];
      let priority = 0;
      if (schedule.dueAt && schedule.dueAt <= at) { priority += 10000; reasons.push('due'); }
      if (recent && ['partial', 'incorrect'].includes(recent.evaluation.status) && Date.parse(at) - Date.parse(recent.submittedAt) <= 7 * DAY) { priority += 1000; reasons.push('recent_mistake'); }
      if (events.length && events.filter(a => a.evaluation.status === 'correct').length / events.length < .7) { priority += 100; reasons.push('low_accuracy'); }
      if (!events.length && q.grammar_tags.some(t => important.has(t))) { priority += 10; reasons.push('important_unseen'); }
      if (!reasons.length) { priority += events.length ? 1 : 5; reasons.push(events.length ? 'maintain' : 'unseen'); }
      const shared = last && q.grammar_tags.some(t => last.questionSnapshot.grammar_tags.includes(t));
      if (last && ['partial', 'incorrect'].includes(last.evaluation.status) && shared && q.id !== last.questionId) { priority += 1000; reasons.push('wrong_variant'); }
      if (q.id === last?.questionId) priority -= 200;
      return { ...copy(q), priority, reasons, reviewSchedule: schedule };
    });
  if(last?.evaluation.status==='correct') rows=rows.filter(q=>!q.grammar_tags.some(t=>last.questionSnapshot.grammar_tags.includes(t)));
  if (last && ['partial', 'incorrect'].includes(last.evaluation.status) && rows.some(q => q.id !== last.questionId && q.grammar_tags.some(t => last.questionSnapshot.grammar_tags.includes(t)))) rows = rows.filter(q => q.id !== last.questionId);
  return rows.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}
/** Weighted observed score; confidence is evidence volume with 30-day recency decay.
 * Trends compare actual oldest/newest halves, and are null without two observations.
 */
export function getGrammarStats(state, grammar = [], now = Date.now()) {
  const at = Date.parse(time(now));
  const ids = [...new Set([...grammar.map(g => g.id), ...state.answers.flatMap(a => a.questionSnapshot.grammar_tags)])];
  return ids.map(id => {
    const events = state.answers.filter(a => a.questionSnapshot.grammar_tags.includes(id) && a.evaluation.status !== 'pending').sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    const value = a => a.evaluation.score !== null ? a.evaluation.score / a.evaluation.maxScore : ({ correct: 1, partial: .5, incorrect: 0 })[a.evaluation.status];
    const weight = a => (1 + DIFFICULTIES.indexOf(a.questionSnapshot.difficulty) * .25) * Math.pow(.5, Math.max(0, at - Date.parse(a.submittedAt)) / (30 * DAY));
    const totalWeight = events.reduce((n, a) => n + weight(a), 0);
    const confidence = 1 - Math.exp(-totalWeight / 5);
    const accuracy = events.length ? events.filter(a => a.evaluation.status === 'correct').length / events.length : null;
    const mean = list => list.reduce((n, a) => n + value(a), 0) / list.length;
    const weighted = totalWeight ? events.reduce((n, a) => n + value(a) * weight(a), 0) / totalWeight : null;
    const schedules = [...new Set(events.map(a => a.questionId))].map(q => getReviewSchedule(state, q));
    return { id, label: grammar.find(g => g.id === id)?.label ?? id, attempts: events.length, accuracy,
      cumulativeMistakes: state.answers.filter(a => a.questionSnapshot.grammar_tags.includes(id) && a.mistakeCounted).length,
      weightedScore: weighted, confidence, mastery: weighted === null ? null : weighted * confidence,
      mastered: schedules.length >= 2 && schedules.every(s => s.mastered) && confidence >= .8,
      trend: events.length < 2 ? null : mean(events.slice(Math.floor(events.length / 2))) - mean(events.slice(0, Math.floor(events.length / 2))),
      observations: events.map(a => ({ answerId: a.id, at: a.submittedAt, score: value(a), difficulty: a.questionSnapshot.difficulty })) };
  });
}
export function validateState(input) {
  jsonSafe(input);
  const s = copy(input);
  if (s.version !== VERSION || !integer(s.revision)) fail('Unsupported version/revision');
  s.questions = unique(s.questions, 'questions').map(validateQuestion);
  s.answers = unique(s.answers, 'answers');
  for (const a of s.answers) {
    str(a.questionId, 'questionId'); validateQuestion(a.questionSnapshot);
    if (a.questionSnapshot.id !== a.questionId || typeof a.input !== 'string' || !a.input.trim() || !['manual', 'self', 'ai'].includes(a.method)
      || !integer(a.submissionCount, 1) || typeof a.mistakeCounted !== 'boolean' || time(a.submittedAt) !== a.submittedAt) fail('Invalid answer');
    if (a.parentAnswerId !== null) {
      const parent = s.answers.find(x => x.id === a.parentAnswerId);
      if (!parent || parent.id === a.id || parent.questionId !== a.questionId || parent.submissionCount >= a.submissionCount) fail('Invalid answer parent');
    }
    let depth=0,parent=a;
    const ancestors=new Set();
    while(parent.parentAnswerId){
      if(ancestors.has(parent.id))fail('Invalid revision cycle');
      ancestors.add(parent.id);parent=s.answers.find(x=>x.id===parent.parentAnswerId);
      if(!parent)fail('Missing revision parent');depth++;
    }
    if(a.resubmissionCount!==undefined&&a.resubmissionCount!==depth)fail('Invalid resubmission count');
    a.resubmissionCount=depth;
    const e = evaluation(a.evaluation, a.questionSnapshot.mode);
    if (!equal(e, a.evaluation) || !equal(a.errorCategories, e.errorCategories)) fail('Invalid evaluation');
    a.audit = unique(a.audit, 'audit');
    let previous = { status: 'pending', score: null, maxScore: a.questionSnapshot.mode === 'short' ? 10 : 20, rubric: null, errorCategories: [], feedback: '' };
    let lastAt = a.submittedAt, wasWrong = false;
    for (const entry of a.audit) {
      if (time(entry.at) !== entry.at || entry.at < lastAt || !equal(previous, entry.previous) || !equal(evaluation(entry.evaluation, a.questionSnapshot.mode), entry.evaluation)) fail('Invalid audit chain');
      previous = entry.evaluation; lastAt = entry.at;
      wasWrong ||= ['partial', 'incorrect'].includes(previous.status);
    }
    if (!equal(previous, a.evaluation) || a.mistakeCounted !== wasWrong) fail('Answer audit mismatch');
  }
  if (!s.drafts || Array.isArray(s.drafts) || Object.values(s.drafts).some(v => typeof v !== 'string')) fail('Invalid drafts');
  if (!s.textbookProgress || Array.isArray(s.textbookProgress)) fail('Invalid textbook progress');
  for (const [book, p] of Object.entries(s.textbookProgress)) {
    str(book, 'book');
    if (!Array.isArray(p.confirmedItems) || p.confirmedItems.some(n => !integer(n, 1)) || new Set(p.confirmedItems).size !== p.confirmedItems.length) fail('Invalid progress');
  }
  if (!s.settings || !['short', 'essay', 'all'].includes(s.settings.mode) || !DIFFICULTIES.includes(s.settings.difficulty) || s.settings.gradingMethod !== 'manual') fail('Invalid settings');
  validateSettings(s.settings);
  if (!s.session || !(s.session.id === null || typeof s.session.id === 'string') || !(s.session.lastAnswerId === null || s.answers.some(a => a.id === s.session.lastAnswerId))) fail('Invalid session');
  if(s.session.position!==undefined&&!integer(s.session.position))fail('Invalid session position');
  if(s.session.limit!==undefined&&![0,5,10,20].includes(s.session.limit))fail('Invalid session limit');
  if(s.session.deadline!=null)time(s.session.deadline);
  if(s.session.draftId!=null)identifier(s.session.draftId,'draft ID');
  if(s.session.currentQuestionId!=null&&!s.questions.some(q=>q.id===s.session.currentQuestionId))fail('Invalid current question');
  for(const key of ['currentAnswerId','parentAnswerId'])if(s.session[key]!=null&&!s.answers.some(a=>a.id===s.session[key]&&a.questionId===s.session.currentQuestionId))fail('Invalid current answer');
  for (const k of ['deferredQuestionIds', 'answeredQuestionIds']) {
    if (!Array.isArray(s.session[k]) || s.session[k].some(id => typeof id !== 'string') || new Set(s.session[k]).size !== s.session[k].length) fail('Invalid session IDs');
  }
  // Schedule is a derived cache, never trusted from an imported file.
  return refreshSchedules(s);
}
export function exportBackup(state) { return JSON.stringify(validateState(state), null, 2); }
export function importBackup(state, backup) {
  const local = validateState(state), incoming = validateState(typeof backup === 'string' ? JSON.parse(backup) : backup);
  const s = copy(local);
  for (const q of incoming.questions) {
    const old = s.questions.find(x => x.id === q.id);
    if (!old) s.questions.push(q);
    else if (!equal(old, q)) {
      const oldTime = Date.parse(old.updated_at), newTime = Date.parse(q.updated_at);
      if (oldTime === newTime) fail(`Question conflict: ${q.id}`);
      if (newTime > oldTime) {
        if (old.deleted && !q.deleted) fail(`Deleted question conflict: ${q.id}`);
        s.questions[s.questions.indexOf(old)] = copy(q);
      }
    }
  }
  for (const a of incoming.answers) {
    const old = s.answers.find(x => x.id === a.id);
    if (!old) { s.answers.push(a); continue; }
    const immutable = ['id', 'questionId', 'questionSnapshot', 'input', 'method', 'submittedAt', 'submissionCount', 'parentAnswerId'];
    if (immutable.some(k => !equal(old[k], a[k]))) fail(`Answer conflict: ${a.id}`);
    const shorter = old.audit.length <= a.audit.length ? old : a;
    const longer = shorter === old ? a : old;
    if (!shorter.audit.every((entry, i) => equal(entry, longer.audit[i]))) fail(`Grade conflict: ${a.id}`);
    s.answers[s.answers.indexOf(old)] = copy(longer);
  }
  // Imports never overwrite local drafts/session/settings or infer textbook progress.
  // Union only explicitly confirmed items from both backups.
  for (const [book, progress] of Object.entries(incoming.textbookProgress)) {
    s.textbookProgress[book] = { confirmedItems: [...new Set([...(s.textbookProgress[book]?.confirmedItems ?? []), ...progress.confirmedItems])].sort((a, b) => a - b) };
  }
  return validateState(s);
}
export const restoreBackup = importBackup;
export function initializeState(storage, questions = []) {
  const raw = storage.getItem(STATE_KEY);
  if (raw !== null) return validateState(JSON.parse(raw));
  const s = createState(questions); storage.setItem(STATE_KEY, exportBackup(s)); return s;
}
export function saveState(storage, state, { expectedRevision } = {}) {
  const s = validateState(state), raw = storage.getItem(STATE_KEY);
  const revision = raw === null ? 0 : validateState(JSON.parse(raw)).revision;
  if (expectedRevision !== undefined && revision !== expectedRevision) fail('Storage conflict: reload and retry');
  s.revision = revision + 1;
  storage.setItem(STATE_KEY, JSON.stringify(s)); return s;
}
const queues = new WeakMap();
/** Prefer navigator.locks across tabs. Without it, serialize this JS realm and use
 * optimistic revision checks. localStorage alone cannot guarantee cross-tab CAS.
 * Never overwrite malformed stored data. Reducers must be synchronous and pure.
 */
export async function transact(storage, updater, { questions = [], locks = globalThis.navigator?.locks } = {}) {
  const run = () => {
    const s = initializeState(storage, questions), next = updater(copy(s));
    if (next?.then) fail('Transaction updater must be synchronous');
    return saveState(storage, next, { expectedRevision: s.revision });
  };
  if (locks?.request) return locks.request(STATE_KEY, { mode: 'exclusive' }, run);
  const previous = queues.get(storage) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(run);
  queues.set(storage, pending);
  try { return await pending; } finally { if (queues.get(storage) === pending) queues.delete(storage); }
}

/** Calendar labels are Japan time; due instants use elapsed-day intervals. */
export function getJstDayKey(now = Date.now()) { return new Date(Date.parse(time(now)) + 9 * 3600000).toISOString().slice(0, 10); }
export function getReviewState(state, questionId, now = Date.now()) {
  const events = state.answers.filter(a => a.questionId === questionId);
  const latest = [...events].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id)).at(-1);
  if (!latest) return 'unpracticed';
  if (latest.evaluation.status === 'pending') return 'checking';
  const schedule = getReviewSchedule(state, questionId);
  if (schedule.lastResult !== 'correct') return 'relearn';
  if (schedule.dueAt && schedule.dueAt <= time(now)) return 'due';
  return schedule.mastered ? 'mastered' : schedule.stage>=3 ? 'checking' : 'waiting';
}
