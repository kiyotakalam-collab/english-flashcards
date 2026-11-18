import { WRITING_BANK_RELEASE } from './writing-bank-manifest.js';
import { parseBankImport, convertBankQuestion } from './writing-bank-import.js';
import { BANK_TARGET, bankCount, createPromptIndex } from './writing-bank.js';
import { initializeState, transact } from './writing-core.js';

/** Fetch/validate the whole release before installing anything. */
export async function loadBundledQuestions(seedQuestions, { fetcher = fetch } = {}) {
  const files = await Promise.all(WRITING_BANK_RELEASE.files.map(async path => {
    const response = await fetcher(new URL(path, import.meta.url));
    if (!response.ok) throw Error(`問題データを読み込めません（${response.status}）。`);
    return parseBankImport(await response.text());
  }));
  const questions = [...seedQuestions], ids = new Set(questions.map(q => q.id));
  const counts = new Map();
  for (const q of questions.filter(q => q.mode === 'short')) {
    const key = `${q.grammar_tags[0]}:${q.difficulty}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const row of files.flat()) {
    const q = convertBankQuestion(row, '2026-11-18T00:00:00.000Z');
    if (ids.has(q.id)) throw Error(`収録問題IDが重複しています：${q.id}`);
    const key = `${row.grammar}:${row.difficulty}`;
    if ((counts.get(key) || 0) >= BANK_TARGET) throw Error(`収録問題が上限を超えています：${key}`);
    q.source = 'original';
    q.source_detail = 'アプリ独自のAI生成問題。AIによる内容再検査済み・人間による検証は未実施。';
    questions.push(q); ids.add(q.id); counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (questions.filter(q => q.mode === 'short').length !== WRITING_BANK_RELEASE.shortCount) {
    throw Error('収録問題数がリリース情報と一致しません。');
  }
  return questions;
}

/** Append only. Existing IDs (including edited/hidden/deleted questions) win. */
export function reconcileBundledQuestions(state, bundled) {
  const ids = new Set(state.questions.map(q => q.id));
  const candidates = bundled.filter(q => !ids.has(q.id));
  if (!candidates.length) return state;
  const counts = new Map(), accepted = [], prompts = createPromptIndex(state.questions.map(q => q.japanese));
  for (const q of candidates) {
    const key = `${q.grammar_tags[0]}:${q.difficulty}`;
    if (!counts.has(key)) counts.set(key, bankCount(state, q.grammar_tags[0], q.difficulty));
    if (q.mode === 'short' && counts.get(key) >= BANK_TARGET) continue;
    if (prompts.has(q.japanese)) continue;
    accepted.push(q); ids.add(q.id); prompts.add(q.japanese);
    if (q.mode === 'short') counts.set(key, counts.get(key) + 1);
  }
  return accepted.length ? { ...state, questions: [...state.questions, ...structuredClone(accepted)] } : state;
}

/** Loading failures keep saved data usable; malformed storage is never replaced. */
export async function initializeBundledBank(storage, seedQuestions, options = {}) {
  const initial = initializeState(storage, seedQuestions);
  let bundled;
  try { bundled = await loadBundledQuestions(seedQuestions, options); }
  catch (error) { return { state: initial, error: error.message, added: 0 }; }
  const preview = reconcileBundledQuestions(initial, bundled);
  if (preview === initial) return { state: initial, error: '', added: 0 };
  const state = await transact(storage, s => reconcileBundledQuestions(s, bundled), {
    questions: seedQuestions, locks: options.locks
  });
  return { state, error: '', added: state.questions.length - initial.questions.length };
}
