// Standalone: deliberately does not import cached app/core modules from older installs.
export const WORD_STORAGE_KEY = 'ex_flashcards_pwa_v2';
export const DATE_UNDO_KEY = 'kotoba_addition_date_repair_20261123_v1';
export const KEEP_FROM = '2026-11-23';
export const BASE_DAY = '2026-11-01';
export const BASE_INSTANT = '2026-10-31T15:00:00.000Z';

function day(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw Error('追加日に不正な値があります。変更せずに中止しました。');
  const datePart = value.slice(0, 10), midnight = new Date(datePart + 'T00:00:00Z');
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== datePart) throw Error('追加日の日付が不正です。');
  const date = new Date(value.length === 10 ? value + 'T00:00:00+09:00' : value);
  if (!Number.isFinite(date.getTime())) throw Error('追加日が不正です。');
  return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
function validate(state) {
  if (state?.schemaVersion !== 2 || !Array.isArray(state.words) || !state.words.length || state.words.length > 50000 ||
      !Array.isArray(state.records) || !state.settings) throw Error('このブラウザーの単語データを読み取れません。変更していません。');
  const ids = new Set();
  for (const word of state.words) {
    if (typeof word?.id !== 'string' || !word.id.trim() || ids.has(word.id)) throw Error('単語IDが不正です。');
    ids.add(word.id); day(word.added_at);
  }
  return state;
}
export function previewDateRepair(state) {
  validate(state);
  const changes = []; let preserved = 0;
  for (const word of state.words) {
    const added = day(word.added_at);
    if (added && added >= KEEP_FROM) { preserved++; continue; }
    if (added === BASE_DAY) continue;
    changes.push({ id: word.id, hadDate: Object.hasOwn(word, 'added_at'), value: word.added_at ?? null });
  }
  return { changes, preserved, total: state.words.length };
}
export function normalizeHistoricalDates(state) {
  const preview = previewDateRepair(state), ids = new Set(preview.changes.map(row => row.id));
  const next = structuredClone(state);
  next.words = next.words.map(word => ids.has(word.id) ? { ...word, added_at: BASE_INSTANT } : word);
  return { state: next, ...preview };
}
function readBackup(raw) {
  if (!raw) return { version: 1, target: BASE_INSTANT, keepFrom: KEEP_FROM, changes: [] };
  const data = JSON.parse(raw);
  if (data.version !== 1 || data.target !== BASE_INSTANT || data.keepFrom !== KEEP_FROM || !Array.isArray(data.changes) || data.changes.length > 50000) throw Error('追加日の復元データが不正です。変更していません。');
  const ids = new Set();
  for (const row of data.changes) {
    if (typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.hadDate !== 'boolean') throw Error('追加日の復元データが不正です。');
    ids.add(row.id); if (row.hadDate) day(row.value);
  }
  return data;
}
export function readWordState(storage) {
  const raw = storage.getItem(WORD_STORAGE_KEY);
  if (!raw) throw Error('このブラウザーに単語データがありません。いつも単語アプリを使っているChromeで開いてください。');
  return validate(JSON.parse(raw));
}
export function applyDateRepair(storage) {
  const result = normalizeHistoricalDates(readWordState(storage));
  if (!result.changes.length) return result;
  const backup = readBackup(storage.getItem(DATE_UNDO_KEY)), ids = new Set(backup.changes.map(row => row.id));
  for (const row of result.changes) if (!ids.has(row.id)) { backup.changes.push(row); ids.add(row.id); }
  // Write the metadata-only undo first. Failed writes never initialize or erase records.
  storage.setItem(DATE_UNDO_KEY, JSON.stringify(backup));
  storage.setItem(WORD_STORAGE_KEY, JSON.stringify(result.state));
  return result;
}
export function undoDateRepair(storage) {
  const state = readWordState(storage), backup = readBackup(storage.getItem(DATE_UNDO_KEY));
  if (!backup.changes.length) return 0;
  const before = new Map(backup.changes.map(row => [row.id, row])); let changed = 0;
  const next = structuredClone(state);
  next.words = next.words.map(word => {
    const saved = before.get(word.id);
    // Keep dates subsequently edited by the user and all newer words/learning events.
    if (!saved || word.added_at !== BASE_INSTANT) return word;
    changed++; const restored = { ...word };
    if (saved.hadDate) restored.added_at = saved.value; else delete restored.added_at;
    return restored;
  });
  if (changed) storage.setItem(WORD_STORAGE_KEY, JSON.stringify(next));
  storage.removeItem(DATE_UNDO_KEY);
  return changed;
}
export function hasDateUndo(storage) { return readBackup(storage.getItem(DATE_UNDO_KEY)).changes.length > 0; }
