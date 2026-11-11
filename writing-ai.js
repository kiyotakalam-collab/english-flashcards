// Shared contract. No provider credentials belong in this browser-safe module.
import { ERROR_CATEGORIES, GRAMMAR } from './writing-data.js';

export const AI_CONFIG_KEY = 'kotoba_writing_ai_endpoint_v1';
export const AI_SESSION_KEY = 'kotoba_writing_ai_access_v1';
export const RUBRIC_KEYS = ['content', 'organization', 'grammar', 'vocabulary'];
const categories = ERROR_CATEGORIES.map(c => c.id);
const textSchema = { type: 'string' };
export const GRADE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['correct', 'partial', 'incorrect', 'pending'] },
    score: { type: ['number', 'null'] },
    rubric: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
      properties: Object.fromEntries(RUBRIC_KEYS.map(k => [k, { type: 'integer', minimum: 0, maximum: 5 }])), required: RUBRIC_KEYS }] },
    correctParts: textSchema,
    grammarErrors: { type: 'array', items: textSchema },
    meaning: textSchema, naturalness: textSchema, improved: textSchema, reason: textSchema,
    errorCategories: { type: 'array', items: { type: 'string', enum: categories } },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  },
  required: ['status', 'score', 'rubric', 'correctParts', 'grammarErrors', 'meaning', 'naturalness', 'improved', 'reason', 'errorCategories', 'confidence']
};

function string(value, max, required = false) {
  return typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
}
export function validateAIRequest(value) {
  const q = value?.question;
  if (!value || !/^[a-zA-Z0-9_-]{1,160}$/.test(value.answerId || '') || !q ||
      !['short', 'essay'].includes(q.mode) || !string(q.japanese, 6000, true) ||
      !string(value.input, q.mode === 'short' ? 4000 : 12000, true) ||
      !Array.isArray(q.reference_answers) || q.reference_answers.length > 8 || q.reference_answers.some(s => !string(s, 2000)) ||
      !Array.isArray(q.grammar_tags) || q.grammar_tags.length > 31 || q.grammar_tags.some(s => !string(s, 80)) ||
      !string(q.difficulty, 80)) throw Error('答案の形式または文字数が不正です。');
  // Allowlist rather than forwarding local storage, prior answers or arbitrary fields.
  return { answerId: value.answerId, question: { mode: q.mode, japanese: q.japanese,
    reference_answers: [...q.reference_answers], grammar_tags: [...q.grammar_tags], difficulty: q.difficulty }, input: value.input };
}
export function requestForAnswer(answer) {
  return validateAIRequest({ answerId: answer.id, question: answer.questionSnapshot, input: answer.input });
}
export function validateAIGrade(value, mode) {
  if (!value || !['correct', 'partial', 'incorrect', 'pending'].includes(value.status) ||
      !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
      !Array.isArray(value.grammarErrors) || value.grammarErrors.length > 30 || value.grammarErrors.some(v => !string(v, 3000)) ||
      !Array.isArray(value.errorCategories) || value.errorCategories.length > 13 || value.errorCategories.some(v => !categories.includes(v)) ||
      !['correctParts', 'meaning', 'naturalness', 'improved', 'reason'].every(k => string(value[k], 14000)) ||
      !value.reason.trim()) throw Error('AIの採点形式を検証できませんでした。');
  let { status, score, rubric } = value;
  if (status === 'correct' && value.errorCategories.length) throw Error('正解判定と誤答分類が矛盾しています。');
  if (status === 'pending') {
    if (score !== null || rubric !== null) throw Error('判定保留の得点が不正です。');
  } else {
    if (!Number.isFinite(score) || score < 0 || score > (mode === 'essay' ? 20 : 10)) throw Error('AIの得点が不正です。');
    if (mode === 'essay') {
      if (!rubric || Object.keys(rubric).length !== 4 || RUBRIC_KEYS.some(k => !Number.isInteger(rubric[k]) || rubric[k] < 0 || rubric[k] > 5) ||
          RUBRIC_KEYS.reduce((sum, k) => sum + rubric[k], 0) !== score) throw Error('AIの20点評価が不正です。');
    } else if (rubric !== null) throw Error('短文の評価形式が不正です。');
  }
  if (value.confidence < 0.65) { status = 'pending'; score = null; rubric = null; }
  return { status, score, rubric, correctParts: value.correctParts, grammarErrors: [...value.grammarErrors],
    meaning: value.meaning, naturalness: value.naturalness, improved: value.improved,
    reason: value.reason, errorCategories: [...new Set(value.errorCategories)], confidence: value.confidence };
}

export function normalizeEndpoint(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/grade') throw Error('添削APIのHTTPS URL（末尾 /grade）を入力してください。');
  return url.href;
}

export async function fetchAIGrade(endpoint, access, answer, { fetcher = fetch, timeout = 55000 } = {}) {
  const url = normalizeEndpoint(endpoint);
  if (typeof access !== 'string' || access.length < 32 || /[\r\n]/.test(access)) throw Error('AI接続コードを設定してください。');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(url, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
      body: JSON.stringify(requestForAnswer(answer)), signal: controller.signal });
    if (!response.ok) {
      const messages = { 401: 'AI接続コードが正しくありません。', 403: 'このアプリからの接続は許可されていません。',
        409: '同じ答案を処理中です。少し待って再試行してください。', 429: 'AIの利用上限に達しました。時間を置いて再試行してください。',
        503: 'AIサーバーが未設定、または一時的に利用できません。', 504: 'AI採点が時間切れになりました。' };
      throw Error(messages[response.status] || 'AI採点に失敗しました。');
    }
    const data = await response.json();
    if (data.answerId !== answer.id || typeof data.evaluation?.feedback !== 'string') throw Error('AI答案IDが一致しません。');
    const evaluation = validateAIGrade(data.evaluation, answer.questionSnapshot.mode);
    const provenance = JSON.parse(data.evaluation.feedback);
    if (provenance.provenance !== 'ai' || typeof provenance.model !== 'string') throw Error('AIの採点元を確認できません。');
    return { ...evaluation, feedback: data.evaluation.feedback };
  } catch (error) {
    if (error.name === 'AbortError') throw Error('AI採点が時間切れになりました。答案は保存されています。');
    throw error;
  } finally { clearTimeout(timer); }
}

/** Generate-only contract. Do not send previous answers or API credentials. */
export function validateGenerationRequest(value) {
  const {mode, difficulty, grammarTag, recentPrompts} = value || {};
  if (!['short','essay'].includes(mode) || !['basic','standard','advanced','keio'].includes(difficulty) ||
    typeof grammarTag !== 'string' || grammarTag.length > 80 ||
    (grammarTag!==''&&!GRAMMAR.some(g=>g.id===grammarTag)) ||
    !Array.isArray(recentPrompts) || recentPrompts.length > 8 ||
    recentPrompts.some(t => !string(t, 350, true))) throw Error('問題生成の設定が不正です。');
  return {mode, difficulty, grammarTag, recentPrompts: [...recentPrompts]};
}
export function validateGeneratedQuestion(value, request) {
  const v = value || {};
  if (!string(v.japanese, request.mode === 'short' ? 240 : 650, true) ||
      !string(v.reference, 1800, true) ||
      !string(v.explanation, 900, true)) throw Error('AI生成問題の形式が不正です。');
  if(request.recentPrompts.includes(v.japanese.trim())) throw Error('同じ問題が生成されました。');
  return {japanese: v.japanese.trim(), reference: v.reference.trim(), explanation: v.explanation.trim()};
}
export function generationEndpoint(gradeEndpoint) {
  return normalizeEndpoint(gradeEndpoint).replace(/\/grade$/, '/generate');
}
export async function fetchAIGeneratedQuestion(gradeEndpoint, access, input, {fetcher=fetch,timeout=55000} = {}) {
  const request=validateGenerationRequest(input);
  if(typeof access!=='string'||access.length<32||access.length>256||/[\r\n]/.test(access)) throw Error('AI接続コードを確認してください。');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
  try {
    const response=await fetcher(generationEndpoint(gradeEndpoint),{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${access}`},body:JSON.stringify(request),signal:controller.signal});
    if(!response.ok) throw Error(({401:'AI接続コードが正しくありません。',403:'AIへの接続が許可されていません。',
      429:'AIの利用上限に達しました。',503:'AI生成サーバーが未対応、または利用できません。',504:'生成が時間切れになりました。'})[response.status]||'AIによる問題生成に失敗しました。');
    const data=await response.json();
    return validateGeneratedQuestion(data.question,request);
  }catch(error){if(error.name==='AbortError')throw Error('AI問題生成が時間切れになりました。');throw error;}
  finally{clearTimeout(timer);}
}
