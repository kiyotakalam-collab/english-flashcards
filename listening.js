import { isUnlearned, matchesSource } from './core.js';

/** Take a read-only snapshot, retaining the No. of the selected source. */
export function createListeningDeck(state, { source = 'all', mode = 'all', start = 1, end = '' } = {}) {
  if (!['all', 'ex', 'reading'].includes(source) || !['all', 'unlearned', 'missed'].includes(mode)) throw Error('聞き流しの条件が不正です。');
  const words = state.words.filter(word => word.active && matchesSource(word, source));
  if (!words.length) return [];
  const first = Number(start), last = String(end).trim() ? Number(end) : words.length;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > words.length) {
    throw Error(`開始・終了番号を1〜${words.length}の範囲で指定してください。終了は開始以上にしてください。`);
  }
  const records = new Map(state.records.map(record => [record.wordId, record]));
  return words.map((word, index) => ({ id: word.id, word: word.word, meaning: word.meaning, number: index + 1 }))
    .slice(first - 1, last).filter(word => {
      const record = records.get(word.id);
      return (mode !== 'unlearned' || isUnlearned(record)) && (mode !== 'missed' || record?.wrongCount > 0);
    });
}

export function voicesFor(speech, language) {
  try { return (speech?.getVoices?.() || []).filter(voice => voice.lang.toLowerCase().replace('_', '-').split('-')[0] === language); }
  catch { return []; } // A broken device voice service must not break vocabulary study.
}

/** Speech is injected for deterministic testing. No timers or state touch learning storage. */
export class ListeningPlayer {
  constructor({ speech = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance,
    onChange = () => {}, clock = globalThis, now = () => Date.now() } = {}) {
    Object.assign(this, { speech, Utterance, onChange, clock, now });
    this.supported = !!(speech && Utterance && typeof speech.speak === 'function' && typeof speech.cancel === 'function');
    this.deck = []; this.index = 0; this.phase = 'english'; this.status = 'idle'; this.token = 0;
    this.timer = null; this.watchdog = null; this.current = null; this.remaining = 0; this.message = '';
  }
  snapshot() {
    return { status: this.status, phase: this.phase, index: this.index, total: this.deck.length,
      item: this.deck[this.index] ? { ...this.deck[this.index] } : null, message: this.message };
  }
  emit() { this.onChange(this.snapshot()); }
  voice(language) {
    const voices = voicesFor(this.speech, language), selected = this.options?.[`${language}Voice`];
    const voice = voices.find(v => v.voiceURI === selected) || voices.find(v => v.localService && v.default) || voices.find(v => v.localService) || voices[0];
    if (!voice) throw Error(`${language === 'en' ? '英語' : '日本語'}の音声が見つかりません。端末の読み上げ設定で音声を追加し、もう一度お試しください。`);
    return voice;
  }
  clear() {
    ++this.token;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    if (this.watchdog !== null) this.clock.clearTimeout(this.watchdog);
    this.timer = this.watchdog = null; this.current = null;
    this.speech?.cancel();
  }
  start(deck, options = {}) {
    this.stop();
    if (!this.supported) throw Error('このブラウザは音声読み上げに対応していません。AndroidのChromeでお試しください。');
    if (!Array.isArray(deck) || !deck.length || deck.some(w => !w.word?.trim() || !w.meaning?.trim())) throw Error('この条件で聞き流せる単語はありません。');
    this.options = { rate: 1, translationDelay: 1000, wordDelay: 1500, loop: false, ...options };
    for (const [key, min, max] of [['rate', 0.5, 2], ['translationDelay', 0, 10000], ['wordDelay', 0, 10000]]) {
      if (!Number.isFinite(this.options[key]) || this.options[key] < min || this.options[key] > max) throw Error('音声の速度・間隔が不正です。');
    }
    this.voice('en'); this.voice('ja');
    this.deck = deck.map(word => ({ ...word })); this.index = 0; this.phase = 'english';
    this.message = ''; this.status = 'playing'; this.perform();
  }
  perform() {
    if (this.status !== 'playing') return;
    if (this.phase.endsWith('-gap')) { this.wait(); return; }
    try {
      const english = this.phase === 'english', voice = this.voice(english ? 'en' : 'ja');
      const utterance = new this.Utterance(english ? this.deck[this.index].word : this.deck[this.index].meaning);
      utterance.lang = voice.lang; utterance.voice = voice; utterance.rate = this.options.rate;
      this.current = utterance; const token = ++this.token;
      const valid = () => this.status === 'playing' && this.token === token && this.current === utterance;
      utterance.onend = () => {
        if (!valid()) return;
        this.clock.clearTimeout(this.watchdog); this.watchdog = null; this.current = null;
        if (!english && this.index === this.deck.length - 1 && !this.options.loop) {
          this.status = 'ended'; this.emit(); return;
        }
        this.phase = english ? 'translation-gap' : 'word-gap';
        this.remaining = english ? this.options.translationDelay : this.options.wordDelay;
        this.perform();
      };
      utterance.onerror = () => { if (valid()) this.fail('音声再生が中断されました。音声の設定と通信を確認して、もう一度再生してください。'); };
      this.watchdog = this.clock.setTimeout(() => { if (valid()) this.fail('音声から応答がありません。別の音声を選んで再生し直してください。'); }, 120000);
      this.emit(); this.speech.speak(utterance);
    } catch (error) { this.fail(error.message); }
  }
  wait() {
    const token = this.token; this.deadline = this.now() + this.remaining;
    this.timer = this.clock.setTimeout(() => {
      if (this.status !== 'playing' || this.token !== token) return;
      this.timer = null;
      if (this.phase === 'word-gap') { this.index = (this.index + 1) % this.deck.length; this.phase = 'english'; }
      else this.phase = 'translation';
      this.perform();
    }, this.remaining);
    this.emit();
  }
  pause() {
    if (this.status !== 'playing') return;
    if (this.phase.endsWith('-gap')) this.remaining = Math.max(0, this.deadline - this.now());
    this.status = 'paused'; this.clear(); this.emit();
  }
  resume() {
    if (this.status !== 'paused') return;
    this.status = 'playing'; this.message = ''; this.perform();
  }
  move(offset) {
    if (!this.deck.length || !['playing', 'paused'].includes(this.status)) return;
    const playing = this.status === 'playing'; this.clear();
    const next = this.index + offset;
    if (next >= this.deck.length && !this.options.loop) { this.status = 'ended'; this.emit(); return; }
    this.index = next >= this.deck.length ? 0 : Math.max(0, next); this.phase = 'english'; this.remaining = 0;
    if (playing) this.perform(); else this.emit();
  }
  stop() { this.status = 'idle'; this.clear(); this.deck = []; this.index = 0; this.phase = 'english'; this.message = ''; this.emit(); }
  fail(message) { this.status = 'error'; this.clear(); this.message = message; this.emit(); }
}
