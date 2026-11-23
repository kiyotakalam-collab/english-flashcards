// This new URL bypasses cached copies of the original date cleanup utility.
// Import only established exports: older installed copies expose these too.
import { WORD_STORAGE_KEY, readWordState, KEEP_FROM } from './addition-dates.js';
export const CORRECTION_KEY = 'kotoba_addition_date_correction_20261123_v1';
export const TODAY_INSTANT = '2026-11-22T15:00:00.000Z';

function backup(storage) {
  const raw = storage.getItem(CORRECTION_KEY);
  if (!raw) return { version: 1, changes: [] };
  const data = JSON.parse(raw), ids = new Set();
  if (data.version !== 1 || !Array.isArray(data.changes) || data.changes.length > 50000) throw Error('日付の修復履歴が不正です。変更していません。');
  for (const row of data.changes) {
    if (typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.hadDate !== 'boolean' || (row.value !== null && typeof row.value !== 'string')) throw Error('日付の修復履歴が不正です。');
    ids.add(row.id);
  }
  return data;
}
export function canCorrect(word) {
  if (!word.added_at) return true;
  const date = new Date(word.added_at.length === 10 ? word.added_at + 'T00:00:00+09:00' : word.added_at);
  const day = new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  return day < KEEP_FROM;
}
export function correctAdditionDates(storage, selectedIds) {
  const state = readWordState(storage), ids = new Set(selectedIds), known = new Set(state.words.map(w => w.id));
  if (!ids.size || [...ids].some(id => !known.has(id))) throw Error('今日追加した単語を一覧から選んでください。');
  const data = backup(storage), saved = new Set(data.changes.map(row => row.id)); let count = 0;
  for (const word of state.words) {
    if (!ids.has(word.id) || !canCorrect(word)) continue;
    if (!saved.has(word.id)) data.changes.push({ id: word.id, hadDate: Object.hasOwn(word, 'added_at'), value: word.added_at ?? null });
    word.added_at = TODAY_INSTANT; count++;
  }
  if (count) {
    storage.setItem(CORRECTION_KEY, JSON.stringify(data));
    storage.setItem(WORD_STORAGE_KEY, JSON.stringify(state));
  }
  return count;
}
export function hasCorrectionUndo(storage) { return backup(storage).changes.length > 0; }
export function undoCorrection(storage) {
  const state = readWordState(storage), data = backup(storage), before = new Map(data.changes.map(row => [row.id, row])); let count = 0;
  for (const word of state.words) {
    const row = before.get(word.id);
    if (!row || word.added_at !== TODAY_INSTANT) continue;
    if (row.hadDate) word.added_at = row.value; else delete word.added_at;
    count++;
  }
  if (count) storage.setItem(WORD_STORAGE_KEY, JSON.stringify(state));
  storage.removeItem(CORRECTION_KEY);
  return count;
}
