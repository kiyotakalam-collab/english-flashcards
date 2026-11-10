import { STATE_KEY, initializeState, validateState, recordAnswer, emptyRecord, parseFeed, upsertWords, restoreBackup, approveDeactivations, validateFeedUrl, matchesSource, shuffleDeck } from './core.js';

const $ = id => document.getElementById(id);
let state, deck = [], index = 0, revealed = false, grading = false;
let activeNumberById = new Map();
let syncPromise = null, syncController, installPrompt, registration, updateRequested = false;
const formatDate = date => date ? new Date(date).toLocaleString('ja-JP') : '未同期';
const recordFor = id => state.records.find(record => record.wordId === id) || emptyRecord(id);
const currentWord = () => state.words.find(word => word.id === deck[index] && word.active);
const sourceLabel = word => ({ex:'準1級EX',reading:'長文'})[word] || '未分類';
const sourceText = word => (word.sources || '').split('|').filter(Boolean).map(sourceLabel).join('・') || '未分類';
function notice(message, error = false) {
  $('notice').textContent = message; $('notice').hidden = !message;
  $('notice').classList.toggle('error', error);
}
function readLatest() {
  const saved = localStorage.getItem(STATE_KEY);
  if (!saved) throw new Error('保存データが見つかりません。再読み込みしてバックアップを確認してください。');
  return validateState(JSON.parse(saved));
}
async function transact(operation) {
  const write = () => {
    const next = operation(readLatest());
    // One atomic write: failed quota/storage writes leave the previous state intact.
    try { localStorage.setItem(STATE_KEY, JSON.stringify(next)); }
    catch { throw new Error('端末に保存できません。空き容量・ブラウザの保存設定を確認し、JSONを書き出してください。'); }
    state = next;
    renderSummary(); renderSettings();
    if (!$('history').hidden) renderHistory();
  };
  if (navigator.locks) await navigator.locks.request(STATE_KEY, write);
  else write();
}
function renderSummary() {
  const total = state.records.reduce((sum, record) => ({ correct: sum.correct + record.correctCount, wrong: sum.wrong + record.wrongCount }), { correct: 0, wrong: 0 });
  $('word-count').textContent = state.words.filter(word => word.active).length.toLocaleString();
  $('wrong-count').textContent = total.wrong.toLocaleString();
  $('accuracy').textContent = total.correct + total.wrong ? (100 * total.correct / (total.correct + total.wrong)).toFixed(1) : '—';
  updateRangeLimits();
}
function updateRangeLimits() {
  if (!state) return;
  const total = state.words.filter(word => word.active && matchesSource(word, $('source-filter').value)).length;
  const maximum = Math.max(total, 1);
  $('start-number').max = String(maximum); $('end-number').max = String(maximum);
  $('range-help').textContent = total ? `選択した登録元の1〜${total}番から出題できます。終了を空欄にすると最後まで出題します。` : 'この登録元に出題できる単語はありません。';
}
function updateOrderControl() {
  const weak = $('mode').value === 'weak';
  $('order').disabled = weak;
  $('order-help').hidden = !weak;
}
function start() {
  const activeWords = state.words.filter(word => word.active && matchesSource(word, $('source-filter').value));
  activeNumberById = new Map(activeWords.map((word, position) => [word.id, position + 1]));
  const total = activeWords.length;
  let first = Number.parseInt($('start-number').value, 10);
  let last = Number.parseInt($('end-number').value, 10);
  first = Number.isInteger(first) ? Math.min(Math.max(first, 1), Math.max(total, 1)) : 1;
  last = Number.isInteger(last) ? Math.min(Math.max(last, first), total) : total;
  $('start-number').value = String(first);
  if ($('end-number').value) $('end-number').value = String(last);
  const selected = total ? activeWords.slice(first - 1, last) : [];
  deck = selected.filter(word => $('mode').value !== 'missed' || recordFor(word.id).wrongCount > 0).map(word => word.id);
  if ($('mode').value === 'weak') deck.sort((a, b) => recordFor(b).wrongCount - recordFor(a).wrongCount);
  else if ($('order').value === 'random') deck = shuffleDeck(deck);
  index = 0; revealed = false; renderCard();
}
function renderCard() {
  while (index < deck.length && !currentWord()) index++;
  const word = currentWord();
  $('front').textContent = word?.word || (deck.length ? '今日の復習、完了。' : '対象の単語はありません');
  $('meaning').textContent = word?.meaning || '';
  $('card-source').textContent = word ? sourceText(word) : '';
  $('meaning').hidden = !revealed || !word;
  $('progress').textContent = word ? `No.${activeNumberById.get(word.id)} · ${String(index + 1).padStart(2, '0')} / ${deck.length} WORDS` : `全 ${deck.length} 語`;
  $('card-wrong').textContent = word ? `この単語の累積誤答 ${recordFor(word.id).wrongCount} 回` : '';
  $('card-hint').textContent = word ? revealed ? '思い出せましたか？ 下のボタンで記録' : 'タップして意味を確認' : '番号範囲を変えて、もう一度開始できます';
  $('card').disabled = !word;
  $('card').setAttribute('aria-expanded', String(revealed));
  $('card').setAttribute('aria-label', word ? `${word.word}：${revealed ? '意味を隠す' : '意味を表示'}` : '学習終了');
  $('correct').disabled = $('wrong').disabled = !word || !revealed || grading;
  $('skip').disabled = !word || grading;
  $('session-done').hidden = !!word || !deck.length;
}
function renderHistory() {
  const query = $('search').value.trim().toLowerCase();
  const numbers = new Map(state.words.filter(word => word.active && matchesSource(word, $('history-source').value)).map((word, position) => [word.id, position + 1]));
  const positions = new Map(state.words.map((word, position) => [word.id, position]));
  const words = state.words.filter(word => ($('show-inactive').checked || word.active) && matchesSource(word, $('history-source').value) && `${word.word} ${word.meaning}`.toLowerCase().includes(query));
  const byNumber = (a, b) => (numbers.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (numbers.get(b.id) ?? Number.MAX_SAFE_INTEGER) || positions.get(a.id) - positions.get(b.id);
  const byWrongCount = (a, b) => recordFor(b.id).wrongCount - recordFor(a.id).wrongCount || byNumber(a, b);
  const byWrongRate = (a, b) => {
    const aRecord = recordFor(a.id), bRecord = recordFor(b.id);
    const aTotal = aRecord.correctCount + aRecord.wrongCount, bTotal = bRecord.correctCount + bRecord.wrongCount;
    if (!aTotal || !bTotal) return bTotal - aTotal || byNumber(a, b);
    return bRecord.wrongCount / bTotal - aRecord.wrongCount / aTotal || byWrongCount(a, b);
  };
  const comparator = { number: byNumber, 'wrong-count': byWrongCount, 'wrong-rate': byWrongRate }[$('history-sort').value] || byNumber;
  words.sort(comparator);
  $('history-count').textContent = `${words.length} 語`;
  const fragment = document.createDocumentFragment();
  for (const word of words) {
    const record = recordFor(word.id), total = record.correctCount + record.wrongCount;
    const row = document.createElement('tr'); row.dataset.wordId = word.id;
    const number = document.createElement('td'); number.className = 'history-number'; number.textContent = numbers.get(word.id) ?? '—';
    const cell = document.createElement('td'), name = document.createElement('strong'), meaning = document.createElement('small');
    cell.className = 'history-word';
    name.textContent = word.word; meaning.textContent = word.meaning;
    cell.append(name, meaning);
    const source = document.createElement('span');
    source.className = 'source-tag'; source.textContent = sourceText(word);
    cell.append(source);
    if (!word.active) { const label = document.createElement('span'); label.className = 'inactive'; label.textContent = '非表示'; cell.append(label); }
    row.append(number, cell);
    for (const [position, value] of [total, record.correctCount, record.wrongCount, total ? `${(100 * record.correctCount / total).toFixed(1)}%` : '—'].entries()) {
      const td = document.createElement('td'); td.textContent = value;
      if (position === 2) td.className = 'wrong-cell';
      row.append(td);
    }
    fragment.append(row);
  }
  if (!words.length) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = 6; cell.textContent = '該当する単語はありません。'; row.append(cell); fragment.append(row);
  }
  $('history-rows').replaceChildren(fragment);
}
function renderSettings() {
  const settings = state.settings;
  $('last-sync').textContent = formatDate(settings.lastSyncAt);
  $('last-added').textContent = settings.lastSyncAt ? `${settings.lastAdded} 語` : '—';
  $('sync-status').textContent = settings.lastSyncError || (settings.feedUrl ? settings.lastSyncAt ? '同期済み' : '同期待ち' : 'URL未設定');
  $('sync-status').classList.toggle('error', !!settings.lastSyncError);
  $('pending-box').hidden = !settings.pendingDeactivations.length;
  $('pending-description').textContent = `${settings.pendingDeactivations.length} 語が単語マスターで非表示に指定されています。確認するまでは学習対象に残します。`;
}
function connection() {
  $('connection').textContent = navigator.onLine ? 'オンライン' : 'オフライン';
  $('connection').classList.toggle('offline', !navigator.onLine);
}
async function grade(correct) {
  const word = currentWord();
  if (!word || !revealed || grading) return;
  grading = true; renderCard();
  try {
    await transact(latest => recordAnswer(latest, word.id, correct));
    index++; revealed = false;
  } catch (error) { notice(error.message, true); }
  finally { grading = false; renderCard(); }
}
async function runSync(manual) {
  const url = state.settings.feedUrl;
  if (!url) { if (manual) notice('同期先の公開CSV / JSON URLを設定してください。'); return; }
  if (!navigator.onLine) { if (manual) notice('オフラインです。保存済みの単語で学習できます。'); return; }
  $('sync-now').disabled = true; $('sync-status').textContent = '同期中…';
  syncController = new AbortController();
  const timeout = setTimeout(() => syncController.abort(), 20000);
  try {
    const response = await fetch(validateFeedUrl(url), { signal: syncController.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`取得失敗 (HTTP ${response.status})`);
    const body = await response.text();
    if (body.length > 10 * 1024 * 1024) throw new Error('単語フィードが大きすぎます（上限10MB）。');
    const words = parseFeed(body); let result;
    await transact(latest => {
      if (latest.settings.feedUrl !== url) return latest;
      result = upsertWords(latest, words);
      result.state.settings.lastSyncAt = new Date().toISOString();
      result.state.settings.lastSyncError = ''; result.state.settings.lastAdded = result.added;
      return result.state;
    });
    if (result) {
      notice(`同期しました。${result.added} 語追加・${result.updated} 語更新。学習回数はそのままです。${result.added ? '追加語は「最初から」で出題されます。' : ''}`);
      // Do not reset an ongoing session when automatic synchronization finishes.
      renderCard();
    }
  } catch (error) {
    const message = error.name === 'AbortError' ? '同期を中断しました（時間切れ、またはURL変更）。' : `同期失敗：${error.message}。URL・公開設定・CORSを確認してください。`;
    try { await transact(latest => {
      if (latest.settings.feedUrl === url) latest.settings.lastSyncError = message;
      return latest;
    }); } catch (saveError) { notice(saveError.message, true); return; }
    notice(`${message} 保存済みの単語と履歴は保持されています。`, true);
  } finally { clearTimeout(timeout); $('sync-now').disabled = false; renderSettings(); }
}
function sync(manual = false) {
  if (!syncPromise) syncPromise = runSync(manual).finally(() => { syncPromise = null; });
  return syncPromise;
}
function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function bindEvents() {
  document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-panel]').forEach(tab => {
      tab.classList.toggle('active', tab === button);
      if (tab === button) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.id !== button.dataset.panel; });
    if (button.dataset.panel === 'history') renderHistory();
  }));
  $('card').onclick = () => { if (currentWord()) { revealed = !revealed; renderCard(); } };
  $('wrong').onclick = () => grade(false); $('correct').onclick = () => grade(true);
  $('restart').onclick = $('again').onclick = start;
  $('mode').onchange = () => { updateOrderControl(); start(); };
  $('order').onchange = start;
  $('source-filter').onchange = () => { $('start-number').value = '1'; $('end-number').value = ''; updateRangeLimits(); start(); };
  $('skip').onclick = () => { index++; revealed = false; renderCard(); };
  $('search').oninput = $('show-inactive').onchange = $('history-sort').onchange = $('history-source').onchange = renderHistory;
  $('sync-now').onclick = () => sync(true);
  $('sync-form').onsubmit = async event => {
    event.preventDefault();
    try {
      const feedUrl = validateFeedUrl($('feed-url').value);
      if (syncPromise) { syncController?.abort(); await syncPromise; }
      await transact(latest => {
        if (latest.settings.feedUrl !== feedUrl) Object.assign(latest.settings, { lastSyncAt: null, lastSyncError: '', lastAdded: 0, pendingDeactivations: [] });
        latest.settings.feedUrl = feedUrl; return latest;
      });
      $('feed-url').value = feedUrl;
      if (feedUrl) await sync(true); else notice('自動同期を停止しました。保存済みの単語と履歴で学習できます。');
    } catch (error) { notice(error.message, true); }
  };
  $('backup').onclick = () => {
    try { state = readLatest(); download(JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2), `kotoba-backup-${new Date().toISOString().slice(0, 10)}.json`); }
    catch (error) { notice(error.message, true); }
  };
  $('restore').onchange = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('10MB以下のJSONファイルを指定してください。');
      const data = JSON.parse(await file.text());
      const preview = restoreBackup(readLatest(), data);
      const increased = preview.records.filter(record => {
        const old = recordFor(record.wordId);
        return record.correctCount > old.correctCount || record.wrongCount > old.wrongCount;
      }).length;
      if (!confirm(`「${file.name}」を取り込みます。\n履歴が増える単語：${increased} 語\n追加される単語：${preview.words.length - state.words.length} 語\n現在の正答・誤答回数は減りません。続けますか？`)) return;
      await transact(latest => restoreBackup(latest, data));
      start(); notice('バックアップを取り込みました。現在とバックアップの大きい回数をそれぞれ保持しました。');
    } catch (error) { notice(`取り込めませんでした：${error.message} 現在の履歴は変更していません。`, true); }
    finally { event.target.value = ''; }
  };
  $('approve-inactive').onclick = async () => {
    try {
      state = readLatest();
      const pending = state.settings.pendingDeactivations;
      const names = state.words.filter(word => pending.includes(word.id)).map(word => word.word);
      if (!confirm(`次の ${names.length} 語を学習対象から非表示にします。履歴は保持します。\n\n${names.join('、')}`)) return;
      await transact(latest => {
        // Approval is limited to the IDs actually displayed to the user.
        const other = latest.settings.pendingDeactivations.filter(id => !pending.includes(id));
        latest.settings.pendingDeactivations = pending;
        const next = approveDeactivations(latest); next.settings.pendingDeactivations = other;
        return next;
      });
      renderCard(); notice('対象の単語を非表示にしました。学習履歴は保持しています。');
    } catch (error) { notice(error.message, true); }
  };
  $('persist').onclick = async () => {
    try {
      const granted = await navigator.storage?.persist?.();
      $('persist-status').textContent = granted ? '長期保存が許可されました。JSONバックアップも保管してください。' : '長期保存は許可されませんでした。定期的にJSONを書き出してください。';
    } catch { $('persist-status').textContent = 'このブラウザでは長期保存をリクエストできません。'; }
  };
  window.addEventListener('online', () => { connection(); sync(); });
  window.addEventListener('offline', connection);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  window.addEventListener('storage', event => {
    if (event.key === STATE_KEY) {
      try { state = readLatest(); renderSummary(); renderSettings(); renderCard(); if (!$('history').hidden) renderHistory(); }
      catch (error) { notice(error.message, true); }
    }
  });
}
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install').hidden = false; });
$('install').onclick = async () => {
  if (!installPrompt) return;
  await installPrompt.prompt(); await installPrompt.userChoice;
  installPrompt = null; $('install').hidden = true;
};
window.addEventListener('appinstalled', () => { $('install').hidden = true; notice('インストールしました。ホーム画面から起動できます。'); });
async function setupOffline() {
  if (!('serviceWorker' in navigator)) { $('offline-status').textContent = 'オフライン機能にはHTTPSとService Worker対応ブラウザが必要です。'; return; }
  try {
    registration = await navigator.serviceWorker.register('./sw.js');
    const showUpdate = () => { if (registration.waiting && navigator.serviceWorker.controller) $('update-app').hidden = false; };
    showUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') showUpdate(); });
    });
    if (navigator.onLine) {
      try { await registration.update(); showUpdate(); } catch { /* Continue with the installed offline version. */ }
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (updateRequested) location.reload(); });
    $('update-app').onclick = () => { updateRequested = true; registration.waiting?.postMessage({ type: 'SKIP_WAITING' }); };
    await navigator.serviceWorker.ready;
    $('offline-status').textContent = '✓ オフラインの準備ができました。通信がなくても起動・学習できます。';
  } catch (error) { $('offline-status').textContent = `オフライン準備に失敗：${error.message}。接続を確認して再読み込みしてください。`; }
}
async function boot() {
  connection();
  try {
    let initial = [];
    const alreadySaved = !!localStorage.getItem(STATE_KEY);
    try {
      // Also load the EX seed on older installed devices to restore missing
      // provenance without touching translations, IDs or learning records.
      const response = await fetch('./initial_words.json');
      if (!response.ok) throw new Error('初期単語を取得できませんでした。');
      initial = await response.json();
    } catch (error) {
      if (!alreadySaved) throw new Error('初期単語を読み込めません。接続を確認して再読み込みしてください。');
      // An already-installed app must still start from its saved vocabulary.
    }
    state = initializeState(localStorage, initial);
    $('feed-url').value = state.settings.feedUrl;
    bindEvents(); updateOrderControl(); renderSummary(); renderSettings(); start();
    void setupOffline(); void sync();
  } catch (error) {
    $('fatal').textContent = `起動できませんでした：${error.message} 保存データは削除していません。元のJSONバックアップを保管し、保存設定とデータ形式を確認してください。`;
    $('fatal').hidden = false; $('front').textContent = '読み込みを確認してください';
    // Keep recovery accessible even though normal navigation has not initialized.
    const recover = document.createElement('button');
    recover.textContent = '保存データを復旧用JSONとして書き出す';
    recover.onclick = () => {
      try {
        const raw = localStorage.getItem(STATE_KEY) || localStorage.getItem('study_flashcards_mistakes_v1');
        if (raw) download(raw, 'kotoba-recovery.json'); else notice('保存データが見つかりません。', true);
      } catch { notice('ブラウザの保存領域にアクセスできません。保存の許可設定を確認してください。', true); }
    };
    $('fatal').append(document.createElement('br'), recover);
  }
}
void boot();
