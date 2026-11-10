import { matchesSource } from './core.js';
import { classifyWord, isReviewDue, tokyoDateKey } from './repetition.js';

const SOURCES = [['all', 'すべて'], ['ex', '準1級EX'], ['reading', '長文']];
const BUCKETS = [
  ['new', '未学習', '#b9bdb1'], ['weak', '要復習', '#b88058'],
  ['learning', '定着途中', '#b59a44'], ['mastered', '安定', '#245c4b'], ['recheck', '再判定待ち', '#83a389']
];
const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const deadline = record => record?.nextReviewAt ? Date.parse(record.nextReviewAt) : NaN;
const dateLabel = key => key.replace(/^(\d+)-(\d+)-(\d+)$/, (_, y, m, d) => `${y}年${Number(m)}月${Number(d)}日`);

/** Presentation only: state and session ownership stay with the application. */
export function createReviewUI({ getState, startSession }) {
  let today = tokyoDateKey(), month = today.slice(0, 7), selectedDate = today;
  let currentRows = [], dayRows = [], currentSource = 'all', detailMode = 'date';
  const snapshot = now => {
    const state = getState(), records = new Map(state.records.map(record => [record.wordId, record]));
    return state.words.filter(word => word.active).map(word => {
      const record = records.get(word.id);
      return { word, record, due: deadline(record), bucket: classifyWord(record, now) };
    });
  };
  const sorted = rows => [...rows].sort((a, b) => (Number.isFinite(a.due) ? a.due : Infinity) - (Number.isFinite(b.due) ? b.due : Infinity));
  function launch(rows, label) {
    if (rows.length) startSession(rows.map(row => row.word.id), label, currentSource);
  }
  function renderMastery(rows, now) {
    const fragment = document.createDocumentFragment();
    for (const [source, label] of SOURCES) {
      const selected = rows.filter(row => matchesSource(row.word, source));
      const counts = Object.fromEntries(BUCKETS.map(([key]) => [key, 0]));
      for (const row of selected) counts[row.bucket]++;
      const section = el('section', 'mastery-source'); section.dataset.source = source;
      section.setAttribute('aria-label', `${label}の定着度`);
      const header = el('div', 'mastery-source-header');
      header.append(el('h4', '', label), el('span', 'mastery-total', `${selected.length.toLocaleString()} 語`));
      const bar = el('div', 'mastery-bar'); bar.setAttribute('aria-hidden', 'true');
      const buckets = el('dl', 'mastery-buckets');
      for (const [key, name, color] of BUCKETS) {
        const part = el('span'); part.style.width = `${selected.length ? counts[key] / selected.length * 100 : 0}%`; part.style.backgroundColor = color; bar.append(part);
        const item = el('div'); item.dataset.bucket = key; item.style.setProperty('--bucket-color', color);
        const value = el('dd');
        const percentage = selected.length ? (counts[key] / selected.length * 100).toFixed(1) : '0.0';
        value.setAttribute('aria-label', `${counts[key]}語、${percentage}%`);
        item.dataset.percentage = percentage;
        value.append(el('span', 'bucket-count', counts[key].toLocaleString()), el('small', 'bucket-percentage bucket-percent', `${percentage}%`));
        item.append(el('dt', '', name), value); buckets.append(item);
      }
      const stats = el('p', 'mastery-stats');
      const due = selected.filter(row => isReviewDue(row.record, now)).length;
      const unscheduled = selected.filter(row => row.bucket !== 'new' && !Number.isFinite(row.due)).length;
      const wrong = selected.reduce((sum, row) => sum + (row.record?.wrongCount || 0), 0);
      for (const [label, value, unit] of [['累積誤答', wrong, '回'], ['現在の期限到来', due, '語'], ['学習済み・予定未設定', unscheduled, '語']]) {
        const stat = el('span', '', label); stat.append(el('strong', '', `${value.toLocaleString()} ${unit}`)); stats.append(stat);
      }
      section.append(header, bar, buckets, stats); fragment.append(section);
    }
    $('review-mastery-sources').replaceChildren(fragment);
  }
  function renderDays(rows) {
    const counts = new Map();
    for (const row of rows) {
      if (!Number.isFinite(row.due)) continue;
      const key = tokyoDateKey(row.due);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const [year, number] = month.split('-').map(Number);
    $('review-month').textContent = `${year}年${number}月`;
    const offset = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
    const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < offset; i++) { const blank = el('span'); blank.setAttribute('aria-hidden', 'true'); fragment.append(blank); }
    for (let day = 1; day <= length; day++) {
      const key = `${month}-${String(day).padStart(2, '0')}`, count = counts.get(key) || 0;
      const button = el('button'); button.type = 'button'; button.dataset.date = key;
      button.classList.toggle('has-due', count > 0); button.classList.toggle('is-today', key === today);
      button.setAttribute('aria-pressed', String(key === selectedDate && detailMode === 'date'));
      if (key === today) button.setAttribute('aria-current', 'date');
      button.setAttribute('aria-label', `${dateLabel(key)}${key === today ? '、今日' : ''}、復習予定 ${count}語`);
      button.append(el('span', 'day-number', day), el('span', 'day-count', count ? `${count}語` : ''));
      fragment.append(button);
    }
    const focused = document.activeElement?.closest('#review-days [data-date]')?.dataset.date;
    $('review-days').replaceChildren(fragment);
    if (focused) $('review-days').querySelector(`[data-date="${focused}"]`)?.focus({ preventScroll: true });
  }
  function renderDetail(rows) {
    dayRows = detailMode === 'due' ? [...currentRows] : sorted(rows.filter(row => Number.isFinite(row.due) && tokyoDateKey(row.due) === selectedDate));
    $('review-date-title').textContent = detailMode === 'due' ? '今日までの復習一覧' : `${dateLabel(selectedDate)}${selectedDate === today ? '（今日）' : ''}`;
    $('review-show-due').setAttribute('aria-pressed', String(detailMode === 'due'));
    $('review-start-date').textContent = detailMode === 'due' ? '一覧の単語を復習する →' : 'この日の単語を復習する →';
    $('review-date-count').textContent = `${dayRows.length.toLocaleString()} 語`;
    $('review-start-date').disabled = !dayRows.length;
    $('review-date-help').textContent = detailMode === 'due' ? '現在までに期限を迎えた単語を、古い期限から表示。再判定待ちには復習予定がないため、この一覧には含めません。' : '選んだ日の予定だけを表示しています。今日の後の時刻の予定も含みます。';
    const fragment = document.createDocumentFragment();
    for (const row of dayRows) {
      const item = el('li'); item.dataset.wordId = row.word.id;
      const body = el('div'); body.append(el('strong', '', row.word.word), el('small', '', row.word.meaning));
      const dueText = Number.isFinite(row.due) ? `${dateLabel(tokyoDateKey(row.due))} 期限` : '再判定待ち・予定未設定';
      const text = `${detailMode === 'due' ? `${dueText}・` : ''}累積誤答 ${row.record?.wrongCount || 0} 回`;
      item.append(body, el('span', 'word-due', text)); fragment.append(item);
    }
    if (!dayRows.length) fragment.append(el('li', 'review-empty', detailMode === 'due' ? '今、期限を迎えている単語はありません。未学習の単語は「学習する」から始められます。' : 'この日の復習予定はありません。未学習の単語は「学習する」から始められます。'));
    const scrollTop = $('review-date-words').scrollTop;
    $('review-date-words').replaceChildren(fragment); $('review-date-words').scrollTop = scrollTop;
  }
  function render() {
    const now = new Date(), nextToday = tokyoDateKey(now);
    if (nextToday !== today) {
      if (month === today.slice(0, 7)) month = nextToday.slice(0, 7);
      if (selectedDate === today) selectedDate = nextToday;
      today = nextToday;
    }
    const rows = snapshot(now); currentSource = $('review-source').value;
    const filtered = rows.filter(row => matchesSource(row.word, currentSource));
    currentRows = sorted(filtered.filter(row => isReviewDue(row.record, now)));
    const overdue = currentRows.filter(row => Number.isFinite(row.due) && tokyoDateKey(row.due) < today).length;
    $('review-due-count').textContent = currentRows.length.toLocaleString();
    $('review-overdue-count').textContent = `うち前日までの期限 ${overdue.toLocaleString()} 語`;
    $('review-start-today').disabled = !currentRows.length;
    renderDays(filtered); renderDetail(filtered); renderMastery(rows, now);
  }
  function moveMonth(delta) {
    const [year, number] = month.split('-').map(Number);
    detailMode = 'date';
    month = new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
    selectedDate = month === today.slice(0, 7) ? today : `${month}-01`;
    render();
  }
  $('review-source').addEventListener('change', render);
  $('review-prev').addEventListener('click', () => moveMonth(-1));
  $('review-next').addEventListener('click', () => moveMonth(1));
  $('review-current').addEventListener('click', () => { detailMode = 'date'; month = tokyoDateKey().slice(0, 7); selectedDate = tokyoDateKey(); render(); });
  $('review-days').addEventListener('click', event => {
    const button = event.target.closest('button[data-date]');
    if (!button) return;
    detailMode = 'date'; selectedDate = button.dataset.date; render();
  });
  // Read again at launch so a transaction or a due timestamp cannot leave a stale deck.
  $('review-show-due').addEventListener('click', () => { detailMode = 'due'; render(); $('review-date-title').scrollIntoView({ block: 'nearest' }); });
  $('review-start-today').addEventListener('click', () => { render(); launch(currentRows, `${dateLabel(today)}・今日までの復習`); });
  $('review-start-date').addEventListener('click', () => { render(); launch(dayRows, detailMode === 'due' ? `${dateLabel(today)}・今日までの復習` : `${dateLabel(selectedDate)}の復習予定`); });
  // Refresh due timestamps as well as the JST date while the app stays foregrounded.
  const timer = window.setInterval(() => { if (document.visibilityState === 'visible') render(); }, 60000);
  return { render, destroy: () => window.clearInterval(timer) };
}
