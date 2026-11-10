import { normalizeSchedule, scheduleAnswer } from './repetition.js';

export const STATE_KEY = 'ex_flashcards_pwa_v2';
export const LEGACY_KEY = 'study_flashcards_mistakes_v1';
/**
 * Randomize a quiz without changing the stable vocabulary order or learning records.
 * Fisher-Yates selects each permutation with equal probability (assuming uniform rng).
 */
export function shuffleDeck(ids, rng = Math.random) {
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const normalizeWord = word => word.trim().toLowerCase().replaceAll('ß', 'ss').replaceAll('ς', 'σ');
const clone = value => structuredClone(value);
const SOURCE_ORDER = ['ex', 'reading'];
/** Source tags are additive. Empty/missing tags mean unclassified, not deletion. */
export function normalizeSources(value) {
  if (value == null || value === '') return '';
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split('|') : null;
  if (!parts) throw new Error('sources は ex、reading、ex|reading、または空欄を指定してください。');
  const tags = new Set(parts.map(part => {
    if (typeof part !== 'string') throw new Error('sources に不正な値があります。');
    return part.trim().toLowerCase();
  }).filter(Boolean));
  if ([...tags].some(tag => !SOURCE_ORDER.includes(tag))) throw new Error('sources に未対応の登録元があります。');
  return SOURCE_ORDER.filter(tag => tags.has(tag)).join('|');
}
export function mergeSources(...values) {
  return normalizeSources(values.flatMap(value => normalizeSources(value).split('|')).filter(Boolean));
}
export function matchesSource(word, source) {
  return source === 'all' || (SOURCE_ORDER.includes(source) && normalizeSources(word.sources).split('|').includes(source));
}
const required = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} が空、または文字列ではありません。`);
  return value.trim();
};
const count = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('学習回数は0以上の整数にしてください。');
  return value;
};
function activeValue(value) {
  if (value === undefined || value === '') return true;
  if (value === true || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || String(value).trim().toLowerCase() === 'false') return false;
  throw new Error('active は TRUE または FALSE にしてください。');
}
export function validateWords(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 50000) throw new Error('単語データは1〜50,000件の配列が必要です。');
  const ids = new Map(), names = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new Error('単語データの形式が不正です。');
    const word = {
      id: required(row.id, 'id'), word: required(row.word, 'word'), meaning: required(row.meaning, 'meaning'),
      range: String(row.range ?? '').trim(), active: activeValue(row.active), updated_at: String(row.updated_at ?? '').trim(), sources: normalizeSources(row.sources)
    };
    const previous = ids.get(word.id), normalized = normalizeWord(word.word);
    if (previous && JSON.stringify(previous) !== JSON.stringify(word)) throw new Error(`id が重複しています: ${word.id}`);
    if (names.has(normalized) && names.get(normalized) !== word.id) throw new Error(`同じ単語に異なるidがあります: ${word.word}`);
    ids.set(word.id, word); names.set(normalized, word.id);
  }
  return [...ids.values()];
}

// RFC 4180: quoted commas, doubled quotes, CRLF and quoted line breaks.
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"') {
      if (cell || closed) throw new Error('CSVの引用符が不正です。');
      quoted = true;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (char !== ',') {
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else {
      if (closed) throw new Error('CSVの引用符の後に不正な文字があります。');
      cell += char;
    }
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません。');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  const headers = rows.shift()?.map(value => value.trim());
  if (!headers || !['id', 'word', 'meaning'].every(name => headers.includes(name)) || new Set(headers).size !== headers.length) {
    throw new Error('CSVの先頭行に id,word,meaning が必要です。Sheetsの編集URLではなく公開CSV URLを設定してください。');
  }
  return rows.map(cells => {
    if (cells.length !== headers.length) throw new Error('CSVの列数が一致しません。');
    return Object.fromEntries(headers.map((name, index) => [name, cells[index]]));
  });
}
export function parseFeed(text) {
  const source = text.trim();
  if (!source || source.startsWith('<')) throw new Error('公開データを取得できません。公開範囲とCSV / JSON URLを確認してください。');
  const data = source.startsWith('[') || source.startsWith('{') ? JSON.parse(source) : parseCSV(source);
  return validateWords(Array.isArray(data) ? data : data.words);
}

export function emptyRecord(id) {
  return { wordId: id, correctCount: 0, wrongCount: 0, lastReviewedAt: null, lastResult: null, ...normalizeSchedule(), answerHistory: [] };
}
function validateAnswerHistory(history = []) {
  if (!Array.isArray(history)) throw new Error('解答履歴が不正です。');
  const seen = new Set();
  return history.map(event => {
    const id = required(event?.id, 'answer id');
    if (seen.has(id) || !['correct', 'wrong'].includes(event.result) ||
        typeof event.reviewedAt !== 'string' || !Number.isFinite(Date.parse(event.reviewedAt))) throw new Error('解答履歴が不正です。');
    seen.add(id);
    return { id, reviewedAt: event.reviewedAt, result: event.result };
  }).sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt) || a.id.localeCompare(b.id));
}
function validateRecord(record) {
  const wordId = required(record?.wordId, 'wordId');
  if (record.lastResult !== null && !['correct', 'wrong'].includes(record.lastResult)) throw new Error('lastResult が不正です。');
  if (record.lastReviewedAt !== null && (typeof record.lastReviewedAt !== 'string' || !Number.isFinite(Date.parse(record.lastReviewedAt)))) throw new Error('学習日時が不正です。');
  return { wordId, correctCount: count(record.correctCount), wrongCount: count(record.wrongCount), lastReviewedAt: record.lastReviewedAt, lastResult: record.lastResult, ...normalizeSchedule(record), answerHistory: validateAnswerHistory(record.answerHistory) };
}
export function createState(initialWords) {
  return {
    schemaVersion: 2, words: validateWords(initialWords), records: [], legacyMigrated: false,
    settings: { feedUrl: '', lastSyncAt: null, lastSyncError: '', lastAdded: 0, pendingDeactivations: [] }
  };
}
export function validateState(data) {
  if (data?.schemaVersion !== 2 || !Array.isArray(data.records) || !data.settings || typeof data.settings.feedUrl !== 'string') throw new Error('対応していないバックアップ形式です。');
  const words = validateWords(data.words), ids = new Set(words.map(word => word.id));
  const records = data.records.map(validateRecord);
  if (new Set(records.map(row => row.wordId)).size !== records.length || records.some(row => !ids.has(row.wordId))) throw new Error('学習記録のidが不正です。');
  return { ...clone(data), words, records, settings: {
    feedUrl: data.settings.feedUrl,
    lastSyncAt: data.settings.lastSyncAt || null, lastSyncError: String(data.settings.lastSyncError || ''),
    lastAdded: Number(data.settings.lastAdded) || 0,
    pendingDeactivations: Array.isArray(data.settings.pendingDeactivations) ? data.settings.pendingDeactivations.filter(id => ids.has(id)) : []
  } };
}
export function recordAnswer(state, id, correct, now = new Date().toISOString()) {
  const next = clone(state);
  if (!next.words.some(word => word.id === id && word.active)) throw new Error('この単語は現在の学習対象ではありません。');
  let record = next.records.find(row => row.wordId === id);
  if (!record) { record = emptyRecord(id); next.records.push(record); }
  const schedule = scheduleAnswer(record, correct, now);
  const scheduleTime = new Date(now).toISOString();
  const field = correct ? 'correctCount' : 'wrongCount';
  record[field] = count(record[field] + 1);
  Object.assign(record, schedule, { lastReviewedAt: scheduleTime, lastResult: correct ? 'correct' : 'wrong' });
  record.answerHistory = validateAnswerHistory(record.answerHistory);
  record.answerHistory.push({ id: crypto.randomUUID(), reviewedAt: scheduleTime, result: record.lastResult });
  record.answerHistory = validateAnswerHistory(record.answerHistory);
  return next;
}
export function upsertWords(state, incoming) {
  incoming = validateWords(incoming);
  const next = clone(state), ids = new Map(next.words.map(word => [word.id, word]));
  const names = new Map(next.words.map(word => [normalizeWord(word.word), word.id]));
  // Resolve by id only. A new id for an existing spelling is a source error,
  // never permission to detach its learning history.
  const incomingById = new Map(incoming.map(word => [word.id, word]));
  const finalWords = next.words.map(word => {
    const updated = incomingById.get(word.id);
    return updated ? { ...updated, sources: mergeSources(word.sources, updated.sources) } : word;
  });
  finalWords.push(...incoming.filter(word => !ids.has(word.id)));
  validateWords(finalWords);
  let added = 0, updated = 0;
  const pending = new Set(next.settings.pendingDeactivations);
  for (const word of incoming) {
    const old = ids.get(word.id);
    if (!old && names.has(normalizeWord(word.word))) throw new Error(`既存単語のidを変更できません: ${word.word}`);
    if (old) {
      if (!word.active && old.active) pending.add(word.id);
      else pending.delete(word.id);
      const replacement = { ...word, sources: mergeSources(old.sources, word.sources), active: word.active ? true : old.active };
      if (JSON.stringify(old) !== JSON.stringify(replacement)) updated++;
      next.words[next.words.findIndex(row => row.id === word.id)] = replacement;
    } else { next.words.push(word); added++; }
  }
  next.settings.pendingDeactivations = [...pending];
  return { state: next, added, updated };
}
export function approveDeactivations(state) {
  const next = clone(state), pending = new Set(next.settings.pendingDeactivations);
  next.words = next.words.map(word => pending.has(word.id) ? { ...word, active: false } : word);
  next.settings.pendingDeactivations = [];
  return next;
}
function mergeRecord(state, incoming) {
  const old = state.records.find(row => row.wordId === incoming.wordId);
  if (!old) { state.records.push(incoming); return; }
  const events = new Map(validateAnswerHistory(old.answerHistory).map(event => [event.id, event]));
  for (const event of validateAnswerHistory(incoming.answerHistory)) {
    const previous = events.get(event.id);
    if (previous && (Date.parse(previous.reviewedAt) !== Date.parse(event.reviewedAt) || previous.result !== event.result)) {
      throw new Error('同じ解答IDの履歴が一致しません。');
    }
    if (!previous) events.set(event.id, event);
  }
  old.answerHistory = [...events.values()].sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt) || a.id.localeCompare(b.id));
  old.correctCount = Math.max(old.correctCount, incoming.correctCount);
  old.wrongCount = Math.max(old.wrongCount, incoming.wrongCount);
  // Select a whole review event, never add streaks or select the largest one.
  // Compare instants, not ISO spellings (backups may contain timezone offsets).
  const oldTime = old.lastReviewedAt === null ? -Infinity : Date.parse(old.lastReviewedAt);
  const incomingTime = incoming.lastReviewedAt === null ? -Infinity : Date.parse(incoming.lastReviewedAt);
  if (incomingTime > oldTime) {
    Object.assign(old, normalizeSchedule(incoming), { lastReviewedAt: incoming.lastReviewedAt, lastResult: incoming.lastResult });
  } else if (incomingTime === oldTime && Number.isFinite(oldTime) && old.lastResult === incoming.lastResult &&
      !normalizeSchedule(old).nextReviewAt && normalizeSchedule(incoming).nextReviewAt) {
    // Same known review: a schedule-bearing backup can enrich an older client.
    Object.assign(old, normalizeSchedule(incoming));
  }
}
export function restoreBackup(state, data) {
  const next = clone(state);
  next.records = next.records.map(validateRecord);
  if (Array.isArray(data)) {
    if (!data.length) throw new Error('旧バックアップが空です。');
    const names = new Map(next.words.map(word => [normalizeWord(word.word), word]));
    const seen = new Set();
    for (const row of data) {
      const word = required(row?.word, 'word'), normalized = normalizeWord(word);
      if (seen.has(normalized)) throw new Error(`旧バックアップの単語が重複しています: ${word}`);
      seen.add(normalized);
      const correctCount = count(row.right), wrongCount = count(row.wrong);
      let target = names.get(normalized);
      if (!target) {
        let id = `legacy:${normalized}`;
        while (next.words.some(word => word.id === id)) id += ':';
        const meaning = typeof row.meaning === 'string' ? row.meaning.trim() : '';
        target = { id, word, meaning: meaning || '（訳は未登録）', range: '', active: true, updated_at: '', sources: '' };
        next.words.push(target); names.set(normalized, target);
      }
      mergeRecord(next, { ...emptyRecord(target.id), correctCount, wrongCount });
    }
  } else {
    const backup = validateState(data);
    // Existing master data wins; backups can add missing words, never roll back
    // a corrected translation, spelling, activation or synchronization settings.
    for (const word of backup.words) {
      const existing = next.words.find(row => row.id === word.id);
      if (existing) existing.sources = mergeSources(existing.sources, word.sources);
      else next.words.push(word);
    }
    validateWords(next.words);
    for (const record of backup.records) mergeRecord(next, record);
  }
  return next;
}
export function initializeState(storage, initialWords) {
  const saved = storage.getItem(STATE_KEY);
  const parsed = saved ? JSON.parse(saved) : null;
  let state = saved ? validateState(parsed) : createState(initialWords);
  let changed = Boolean(saved && parsed.records.some(record =>
    ['correctStreak', 'intervalDays', 'nextReviewAt', 'answerHistory'].some(field => record[field] === undefined)));
  if (!state.legacyMigrated) {
    const legacy = storage.getItem(LEGACY_KEY);
    if (legacy) {
      const data = JSON.parse(legacy);
      if (!Array.isArray(data)) throw new Error('旧学習記録の形式が不正です。');
      if (data.length) state = restoreBackup(state, data);
    }
    state.legacyMigrated = true;
    changed = true;
  }
  // The original bundled 308 words are EX vocabulary even on old saved devices.
  // Never replace saved word text, IDs, scores or other provenance.
  const seedSources = new Map(initialWords.map(word => [word.id, normalizeSources(word.sources)]));
  state.words = state.words.map(word => {
    const sources = mergeSources(word.sources, seedSources.get(word.id));
    if (sources === word.sources) return word;
    changed = true;
    return { ...word, sources };
  });
  if (changed) storage.setItem(STATE_KEY, JSON.stringify(state));
  return state;
}
export function validateFeedUrl(value) {
  if (!value.trim()) return '';
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('公開CSV / JSONの完全なHTTPS URLを入力してください。'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('認証情報を含まないHTTPS URLを指定してください。');
  return url.href;
}
