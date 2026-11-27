import * as Core from './usage-core.js';
import { CATEGORIES } from './usage-data.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = value => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
let state, busy = false, pending = Promise.resolve(), screen = 'study';
function notice(message, error = false) { $('notice').hidden = false; $('notice').textContent = message; $('notice').classList.toggle('error', error); }
async function mutate(operation) {
  const operationPromise = pending.then(() => Core.transact(localStorage, operation));
  pending = operationPromise.catch(() => {});
  state = await operationPromise; return state;
}
function summary() {
  $('item-count').textContent = state.items.filter(q => q.active).length;
  $('attempt-count').textContent = state.attempts.length;
  $('wrong-count').textContent = state.attempts.filter(a => !a.correct).length;
  const pool = state.items.filter(q => q.active && ($('category').value === 'all' || q.category === $('category').value));
  const count = $('count').value === 'all' ? pool.length : Math.min(Number($('count').value), pool.length);
  $('pool-note').textContent = `出題対象 ${pool.length}語法から ${count}問。毎回ランダム・同一テスト内の重複なし。`;
  $('start').disabled = !pool.length || busy;
  const test = state.tests.at(-1), left = test?.reviewRemainingIds.length ?? 0;
  $('review-summary').textContent = !test ? 'まだテストを受けていません。' : !test.completedAt ? 'テストを最後まで回答すると、今回の誤答だけを復習できます。' : left ? `今回のテスト：${test.questions.length}問中 ${test.wrongIds.length}問に誤答。復習で残っているのは ${left}問です。` : test.wrongIds.length ? '今回の誤答はすべて復習できました。復習完了です。' : '今回のテストは全問正解です。誤答復習の対象はありません。';
  $('review').disabled = busy || !test?.completedAt || !left;
}
function show(page) {
  screen = page;
  for (const button of document.querySelectorAll('[data-page]')) {
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.id !== page;
  if (page === 'study') renderExercise(); else if (page === 'items') renderItems(); else renderHistory();
}
function focusQuestion() {
  if (screen !== 'study') return;
  $('exercise').scrollIntoView({ block: 'start' }); $('answer-input')?.focus({ preventScroll: true });
}
function context() { return { sessionId: state.session.id, index: state.session.index }; }
function renderExercise() {
  const s = state.session;
  if (!s) { $('exercise').replaceChildren(); return; }
  const test = state.tests.find(t => t.id === s.testId), question = Core.currentQuestion(state);
  if (s.phase === 'complete') {
    const correct = test.questions.length - test.wrongIds.length;
    $('exercise').innerHTML = `<section class="card"><p class="eyebrow">${s.mode === 'test' ? 'TEST RESULT' : 'REVIEW COMPLETE'}</p><h2>${s.mode === 'test' ? '今回のテスト結果' : '誤答復習が完了しました'}</h2><p class="result-number">${s.mode === 'test' ? `${correct} / ${test.questions.length}` : 'すべて正解'}</p><p class="muted">${s.mode === 'test' ? `正解 ${correct}問・不正解 ${test.wrongIds.length}問。下のボタンから今回の誤答だけを復習できます。` : '正解した語法を復習セットからすべて除外しました。累積誤答と回答履歴は残っています。'}</p></section>`;
    return;
  }
  const attempt = s.phase === 'feedback' && state.attempts.find(a => a.id === s.feedbackAttemptId);
  $('exercise').innerHTML = `<section class="card question"><div class="question-meta"><span>${s.mode === 'test' ? 'テスト' : '今回の誤答復習'} · ${s.mode === 'test' ? `${s.index + 1} / ${s.queue.length}問` : `未解決 ${test.reviewRemainingIds.length}問`}</span><span>${esc(question.category)}</span></div><p class="question-japanese" id="question-japanese">${esc(question.Japanese)}</p><form id="answer-form"><label for="answer-input">英語で回答</label><input class="answer-input" id="answer-input" lang="en" type="text" maxlength="1000" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="覚えた語法を入力" ${attempt ? 'readonly' : ''}><p class="answer-guidance">A・人・もの・～は変数として入力できます。S V は主語・動詞の型です。Enterで回答、結果の後はEnterで次へ。</p><button id="grade" class="primary" type="submit" ${attempt ? 'hidden' : ''} disabled>回答する</button></form>${attempt ? `<section class="feedback" id="feedback" aria-live="polite"><p class="verdict ${attempt.correct ? '' : 'incorrect'}">${attempt.correct ? '正解' : '不正解'}</p><dl><dt>あなたの回答</dt><dd class="user-answer">${esc(attempt.answer)}</dd><dt>正答</dt><dd lang="en">${esc(attempt.snapshot.English)}</dd><dt>例文</dt><dd class="example" lang="en">${esc(attempt.snapshot.example)}</dd></dl><p class="help">大文字小文字・文末ピリオド・余分なスペースは判定に影響しません。前置詞・語順・動詞の形は正確に。</p><button class="primary" id="next">${s.mode === 'test' && s.index + 1 === s.queue.length ? '結果を見る' : s.mode === 'review' && !test.reviewRemainingIds.length ? '復習を完了する' : '次の問題へ'}</button></section>` : ''}</section>`;
  $('answer-input').value = s.draft;
  $('answer-input').oninput = event => {
    const text = event.target.value, ctx = context(); $('grade').disabled = busy || !text.trim();
    mutate(latest => Core.saveDraft(latest, text, ctx.sessionId, ctx.index)).catch(error => notice(`入力を保存できませんでした：${error.message}`, true));
  };
  $('grade').disabled = busy || !s.draft.trim();
  $('answer-form').onsubmit = async event => {
    event.preventDefault(); if (busy || state.session.phase !== 'answer') return;
    const text = $('answer-input').value, ctx = context(); if (!text.trim()) return;
    busy = true; $('grade').disabled = true;
    try { await mutate(latest => Core.submitAnswer(latest, text, ctx)); renderExercise(); summary(); $('next')?.focus({ preventScroll: true }); }
    catch (error) { notice(`回答を保存できませんでした：${error.message}`, true); }
    finally { busy = false; summary(); if ($('grade')) $('grade').disabled = state.session.phase !== 'answer' || !$('answer-input').value.trim(); }
  };
  if ($('next')) $('next').onclick = async () => {
    if (busy) return; const ctx = context(); busy = true; $('next').disabled = true;
    try { await mutate(latest => Core.nextQuestion(latest, ctx)); renderExercise(); focusQuestion(); }
    catch (error) { notice(error.message, true); if ($('next')) $('next').disabled = false; }
    finally { busy = false; summary(); }
  };
}
function resetEditor() { $('item-form').reset(); $('edit-id').value = ''; $('editor-title').textContent = '語法を追加'; }
function renderItems() {
  const query = $('item-search').value.trim().toLowerCase(), rows = state.items.filter(q => `${q.Japanese} ${q.English}`.toLowerCase().includes(query));
  $('item-list').innerHTML = rows.map(q => {
    const stats = Core.itemStats(state, q.id);
    return `<article class="row"><strong>${esc(q.Japanese)}</strong><p class="english" lang="en">${esc(q.English)}</p><p lang="en">${esc(q.example)}</p><small>${esc(q.category)} · ${q.active ? '出題中' : '非表示'} · 回答 ${stats.attempts}回 / 累積誤答 ${stats.wrong}回</small><div><button data-edit="${esc(q.id)}">編集・非表示の設定</button></div></article>`;
  }).join('') || '<p class="muted">該当する語法がありません。</p>';
  for (const button of $('item-list').querySelectorAll('[data-edit]')) button.onclick = () => {
    const q = state.items.find(q => q.id === button.dataset.edit);
    $('edit-id').value = q.id; $('japanese').value = q.Japanese; $('english').value = q.English;
    $('example').value = q.example; $('item-category').value = q.category; $('active').checked = q.active;
    $('editor-title').textContent = '語法を編集'; $('item-form').scrollIntoView({ block: 'start' }); $('japanese').focus({ preventScroll: true });
  };
}
function renderHistory() {
  $('test-history').innerHTML = state.tests.slice(-20).reverse().map(t => `<article class="row"><strong>${date(t.startedAt)}</strong><p>${t.questions.length}問 · ${t.completedAt ? `正解 ${t.questions.length - t.wrongIds.length} / 不正解 ${t.wrongIds.length}` : '途中のテスト'}${t === state.tests.at(-1) ? ' · 今回のテスト' : ''}</p><small>誤答復習で未解決 ${t.reviewRemainingIds.length}問</small></article>`).join('') || '<p class="muted">まだテスト履歴がありません。</p>';
  $('answer-history').innerHTML = state.attempts.slice(-100).reverse().map(a => `<article class="row"><strong>${a.correct ? '正解' : '不正解'} · ${esc(a.snapshot.Japanese)}</strong><p class="english" lang="en">${esc(a.answer)}</p><p>正答：<span lang="en">${esc(a.snapshot.English)}</span></p><small>${date(a.answeredAt)} · ${a.mode === 'test' ? 'テスト' : '今回の誤答復習'}</small></article>`).join('') || '<p class="muted">まだ回答履歴がありません。</p>';
}
function download(value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })), link = document.createElement('a');
  link.href = url; link.download = 'usage-master-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bind() {
  for (const id of ['category', 'item-category']) for (const category of CATEGORIES) { const option = document.createElement('option'); option.value = category; option.textContent = category; $(id).append(option); }
  $('count').value = state.settings.count; $('category').value = state.settings.category;
  for (const button of document.querySelectorAll('[data-page]')) button.onclick = () => show(button.dataset.page);
  $('count').onchange = $('category').onchange = summary;
  $('setup').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const options = { count: $('count').value, category: $('category').value }; busy = true; summary();
    try { await mutate(latest => Core.startTest(latest, options)); renderExercise(); focusQuestion(); }
    catch (error) { notice(error.message, true); } finally { busy = false; summary(); }
  };
  $('review').onclick = async () => {
    if (busy) return; busy = true; summary();
    try { await mutate(latest => Core.startReview(latest)); renderExercise(); focusQuestion(); }
    catch (error) { notice(error.message, true); } finally { busy = false; summary(); }
  };
  $('item-search').oninput = renderItems; $('cancel-edit').onclick = resetEditor;
  $('item-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const data = { id: $('edit-id').value || undefined, Japanese: $('japanese').value, English: $('english').value, example: $('example').value, category: $('item-category').value, active: $('active').checked };
    busy = true; $('save-item').disabled = true;
    try { await mutate(latest => Core.saveItem(latest, data)); resetEditor(); renderItems(); summary(); notice('語法を保存しました。次に始めるテストから反映されます。'); }
    catch (error) { notice(error.message, true); $('notice').scrollIntoView({ block: 'nearest' }); }
    finally { busy = false; $('save-item').disabled = false; summary(); }
  };
  $('export').onclick = () => { try { download(Core.exportBackup(Core.readState(localStorage))); } catch (error) { notice(error.message, true); } };
  $('import').onchange = async event => {
    const file = event.target.files[0]; if (!file || busy) return; busy = true;
    try {
      if (file.size > 4 * 1024 * 1024) throw Error('JSONは4MB以内にしてください。');
      const data = JSON.parse(await file.text()); await mutate(latest => Core.restoreBackup(latest, data));
      renderHistory(); summary(); notice('語法データを取り込みました。同じ回答は二重に数えていません。');
    } catch (error) { notice(error.message, true); } finally { busy = false; event.target.value = ''; summary(); }
  };
  window.addEventListener('storage', event => {
    if (event.key !== Core.STATE_KEY) return;
    try { state = Core.readState(localStorage); summary(); if (screen !== 'study' || document.activeElement?.id !== 'answer-input') show(screen); }
    catch (error) { notice(error.message, true); }
  });
}
async function offline() {
  if (!('serviceWorker' in navigator)) { $('offline-status').textContent = 'オフライン機能は利用不可'; return; }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    const check = () => {
      $('update-app').hidden = !registration.waiting;
      $('offline-status').textContent = registration.waiting ? '最新版に更新すると語法をオフラインで利用できます' : registration.installing ? 'オフライン準備中' : 'オフライン利用の準備ができました';
    };
    registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', check)); check();
    let requested = false;
    $('update-app').onclick = () => { requested = true; registration.waiting?.postMessage({ type: 'SKIP_WAITING' }); };
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (requested) location.reload(); else check(); });
    try { await registration.update(); } catch { /* Installed assets can still be used offline. */ }
    await navigator.serviceWorker.ready; check();
  } catch { $('offline-status').textContent = 'オフライン準備に失敗しました。オンラインで開き直してください。'; }
}
try {
  state = Core.initializeState(localStorage); bind(); summary(); renderExercise(); offline();
} catch (error) {
  $('fatal').hidden = false; $('fatal').textContent = `保存データは初期化していません。${error.message}`;
  document.querySelectorAll('button,input,select').forEach(element => element.disabled = true);
}
