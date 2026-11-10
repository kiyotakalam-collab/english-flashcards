// Calendar-based scheduling in Japan. No storage, counters, or vocabulary writes.
const DAY_MS = 86400000;
const INTERVALS = [1, 3, 7, 14, 30, 60];
const FIELDS = ['correctStreak', 'intervalDays', 'nextReviewAt'];

function instant(value) {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('学習日時が不正です。');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('学習日時が不正です。');
  return date;
}

/** Date, ISO timestamp, or epoch milliseconds -> YYYY-MM-DD in Asia/Tokyo. */
export function tokyoDateKey(date = new Date()) {
  return new Date(instant(date).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

/** Old records have no inferred streak or deadline. Partial/corrupt metadata rejects. */
export function normalizeSchedule(record) {
  const present = FIELDS.filter(field => record?.[field] !== undefined);
  if (!present.length) return { correctStreak: 0, intervalDays: 0, nextReviewAt: null };
  const { correctStreak, intervalDays, nextReviewAt } = record;
  if (present.length !== FIELDS.length || !Number.isSafeInteger(correctStreak) || correctStreak < 0 ||
      ![0, ...INTERVALS].includes(intervalDays) ||
      (nextReviewAt !== null && (typeof nextReviewAt !== 'string' || !Number.isFinite(Date.parse(nextReviewAt)))) ||
      (intervalDays > 0 && nextReviewAt === null) ||
      (intervalDays === 0 && correctStreak !== 0) ||
      (intervalDays > 0 && (correctStreak === 0 || intervalDays !== INTERVALS[Math.min(correctStreak, INTERVALS.length) - 1]))) {
    throw new Error('復習スケジュールが不正です。');
  }
  return { correctStreak, intervalDays, nextReviewAt };
}

/**
 * Returns scheduling fields only; call before updating lastReviewedAt/lastResult.
 * Correct answers before the due instant preserve the schedule. Thus rapid
 * clicks cannot create a spaced success. A wrong answer resets to ten minutes.
 */
export function scheduleAnswer(record, correct, now = new Date()) {
  if (typeof correct !== 'boolean') throw new Error('学習結果が不正です。');
  const date = instant(now), schedule = normalizeSchedule(record);
  if (correct && record?.lastResult === 'correct' && schedule.nextReviewAt &&
      date.getTime() < instant(schedule.nextReviewAt).getTime()) return schedule;
  const correctStreak = correct ? Math.min(schedule.correctStreak + 1, INTERVALS.length) : 0;
  const intervalDays = correct ? INTERVALS[correctStreak - 1] : 0;
  const nextReviewAt = new Date(date.getTime() + (correct ? intervalDays * DAY_MS : 10 * 60000)).toISOString();
  return { correctStreak, intervalDays, nextReviewAt };
}

/** Exclusive UI category. Historical errors alone never make a recovered card weak. */
export function classifyWord(record, now = new Date()) {
  const date = instant(now);
  if (!record || !(record.correctCount > 0 || record.wrongCount > 0)) return 'new';
  const schedule = normalizeSchedule(record);
  if (!schedule.nextReviewAt) return 'recheck';
  if (record.lastResult === 'wrong' || (record.lastResult == null && record.wrongCount > 0)) return 'weak';
  if (date.getTime() > instant(schedule.nextReviewAt).getTime()) return 'weak';
  return schedule.correctStreak >= 5 && schedule.intervalDays >= 30 ? 'mastered' : 'learning';
}

/** Recheck/weak/learning/mastered are categories; a deadline is independent. */
export function isReviewDue(record, now = new Date()) {
  const date = instant(now);
  if (!record || !(record.correctCount > 0 || record.wrongCount > 0)) return false;
  const schedule = normalizeSchedule(record);
  return Boolean(schedule.nextReviewAt && instant(schedule.nextReviewAt).getTime() <= date.getTime());
}
