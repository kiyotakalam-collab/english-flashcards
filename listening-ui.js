import { createListeningDeck, ListeningPlayer, voicesFor } from './listening.js';
import { matchesSource } from './core.js';

export function createListeningUI({ getState }) {
  const $ = id => document.getElementById(id);
  const status = $('listen-status');
  let lock = null, acquiring = false;
  const player = new ListeningPlayer({ onChange: render });
  function show(message, error = false) { status.textContent = message; status.classList.toggle('error', error); }
  async function wake() {
    const needed = player.status === 'playing' && $('listen-awake').checked && !document.hidden;
    if (!needed) { const old = lock; lock = null; try { await old?.release(); } catch { /* Optional screen lock. */ } return; }
    if (lock || acquiring || !navigator.wakeLock) return;
    acquiring = true;
    try {
      const candidate = await navigator.wakeLock.request('screen');
      if (player.status !== 'playing' || !$('listen-awake').checked || document.hidden) await candidate.release();
      else { lock = candidate; candidate.addEventListener('release', () => { if (lock === candidate) lock = null; }); }
    } catch { /* Playback still works without a screen lock. */ }
    finally { acquiring = false; }
  }
  function render(snapshot) {
    const active = ['playing', 'paused'].includes(snapshot.status);
    $('listen-pause').disabled = !active;
    $('listen-pause').textContent = snapshot.status === 'paused' ? '再開' : '一時停止';
    $('listen-stop').disabled = !active;
    $('listen-prev').disabled = !active || snapshot.index === 0;
    $('listen-next').disabled = !active;
    $('listen-word').textContent = snapshot.item?.word || '英語 → 日本語訳';
    $('listen-meaning').textContent = snapshot.item?.meaning || '範囲を選んで再生してください。';
    $('listen-progress').textContent = snapshot.item ? `No.${snapshot.item.number} · ${snapshot.index + 1} / ${snapshot.total} 語` : '';
    const phase = ({ english: '英語を読み上げています', translation: '訳を読み上げています', 'translation-gap': '訳の前の待ち時間', 'word-gap': '次の単語までの待ち時間' })[snapshot.phase];
    show(snapshot.status === 'playing' ? phase : snapshot.status === 'paused' ? '一時停止中。再開すると現在のフレーズの先頭から読み上げます。' : snapshot.status === 'ended' ? '指定範囲の聞き流しが終了しました。' : snapshot.status === 'error' ? snapshot.message : '再生待ち', snapshot.status === 'error');
    void wake();
  }
  function refreshVoices() {
    for (const [id, lang] of [['listen-en-voice', 'en'], ['listen-ja-voice', 'ja']]) {
      const select = $(id), selected = select.value;
      select.replaceChildren(new Option('端末のおすすめ', ''));
      for (const voice of voicesFor(window.speechSynthesis, lang)) select.add(new Option(`${voice.name}${voice.localService ? '（端末音声）' : '（通信音声）'}`, voice.voiceURI));
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    }
    $('listen-play').disabled = !player.supported;
    if (!player.supported) show('このブラウザは読み上げ非対応です。AndroidのChromeでお試しください。', true);
  }
  function refresh() {
    const total = getState().words.filter(word => word.active && matchesSource(word, $('listen-source').value)).length;
    $('listen-start').max = $('listen-end').max = String(Math.max(1, total));
    $('listen-range-help').textContent = total ? `この登録元のNo.1〜${total}。終了が空欄なら最後まで読み上げます。` : 'この登録元に単語はありません。';
  }
  $('listening-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const deck = createListeningDeck(getState(), { source: $('listen-source').value, mode: $('listen-mode').value,
        start: $('listen-start').value, end: $('listen-end').value });
      player.start(deck, { rate: Number($('listen-rate').value), translationDelay: Number($('listen-translation-delay').value),
        wordDelay: Number($('listen-word-delay').value), loop: $('listen-loop').checked,
        enVoice: $('listen-en-voice').value, jaVoice: $('listen-ja-voice').value });
    } catch (error) { player.stop(); show(error.message, true); }
  });
  $('listening-form').addEventListener('change', event => {
    if (event.target.id === 'listen-awake') { void wake(); return; }
    const active = ['playing', 'paused'].includes(player.status); player.stop();
    if (event.target.id === 'listen-source') { $('listen-start').value = '1'; $('listen-end').value = ''; }
    refresh(); if (active) show('設定を変更しました。「この範囲を再生」で再生し直せます。');
  });
  $('listen-pause').onclick = () => player.status === 'paused' ? player.resume() : player.pause();
  $('listen-stop').onclick = () => player.stop();
  $('listen-prev').onclick = () => player.move(-1);
  $('listen-next').onclick = () => player.move(1);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && player.status === 'playing') {
      player.pause(); show('画面が非表示になったため一時停止しました。画面を開き「再開」を押してください。');
    }
    if (!document.hidden) refreshVoices();
  });
  window.addEventListener('pagehide', () => player.stop());
  window.speechSynthesis?.addEventListener?.('voiceschanged', refreshVoices);
  render(player.snapshot()); refresh(); refreshVoices();
  return { refresh };
}
