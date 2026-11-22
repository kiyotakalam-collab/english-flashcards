import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createListeningDeck, ListeningPlayer } from '../listening.js';

const deck = [{ id: 'a', number: 101, word: 'observe', meaning: '観察する' }, { id: 'b', number: 102, word: 'assure', meaning: '保証する' }];
class Clock {
  time = 0; next = 0; tasks = new Map();
  setTimeout(fn, delay) { const id = ++this.next; this.tasks.set(id, { at: this.time + delay, fn }); return id; }
  clearTimeout(id) { this.tasks.delete(id); }
  tick(delay) {
    const end = this.time + delay;
    for (let n = 0; n < 1000; n++) {
      const due = [...this.tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) { this.time = end; return; }
      this.tasks.delete(due[0]); this.time = due[1].at; due[1].fn();
    }
    throw Error('Timer loop');
  }
}
function fixture(extra = {}) {
  const clock = new Clock(), spoken = [], changes = [];
  const speech = { active: null, cancel() { const old = this.active; this.active = null; old?.onend(); },
    getVoices: () => [{ voiceURI: 'en', lang: 'en-US', localService: true }, { voiceURI: 'ja', lang: 'ja-JP', localService: true }],
    speak(u) { spoken.push(u); this.active = u; }, end() { const u = this.active; this.active = null; u.onend(); } };
  class Utterance { constructor(text) { this.text = text; } }
  const player = new ListeningPlayer({ speech, Utterance, clock, now: () => clock.time, onChange: s => changes.push(s), ...extra });
  const start = (options = {}, words = deck) => player.start(words, { translationDelay: 10, wordDelay: 20, ...options });
  return { player, speech, clock, spoken, changes, start };
}
test('source-relative range, filters and stable No. are read-only and do not include inactive words', () => {
  const word = (id, sources, active = true) => ({ id, word: id, meaning: id + 'の訳', sources, active });
  const state = { words: [word('a', 'ex|reading'), word('b', 'ex'), word('hidden', 'reading', false), word('d', 'reading')],
    records: [{ wordId: 'a', correctCount: 1, wrongCount: 0 }, { wordId: 'b', correctCount: 0, wrongCount: 5 }] };
  const before = JSON.stringify(state);
  assert.deepEqual(createListeningDeck(state, { source: 'reading', start: 2, end: 2 }).map(w => [w.id, w.number]), [['d', 2]]);
  assert.deepEqual(createListeningDeck(state, { mode: 'unlearned' }).map(w => w.id), ['d']);
  assert.deepEqual(createListeningDeck(state, { mode: 'missed', start: 1, end: 2 }).map(w => w.id), ['b']);
  assert.deepEqual(createListeningDeck(state, { source: 'ex', mode: 'unlearned' }), []);
  for (const range of [{ start: 0 }, { start: 2, end: 1 }, { end: 9 }, { start: 1.5 }, { start: 'bad' }]) assert.throws(() => createListeningDeck(state, range));
  assert.equal(JSON.stringify(state), before);
});
test('speaks English then Japanese with separate gaps and ends at the last selected word', () => {
  const f = fixture(); f.start({ rate: 1.25 });
  assert.equal(f.spoken[0].text, 'observe'); assert.equal(f.spoken[0].lang, 'en-US'); assert.equal(f.spoken[0].rate, 1.25);
  f.speech.end(); f.clock.tick(9); assert.equal(f.spoken.length, 1);
  f.clock.tick(1); assert.equal(f.spoken[1].text, '観察する'); assert.equal(f.spoken[1].lang, 'ja-JP');
  f.speech.end(); f.clock.tick(19); assert.equal(f.spoken.length, 2);
  f.clock.tick(1); assert.equal(f.spoken[2].text, 'assure');
  f.speech.end(); f.clock.tick(10); assert.equal(f.spoken[3].text, '保証する');
  f.speech.end(); assert.equal(f.player.status, 'ended'); assert.equal(f.clock.tasks.size, 0);
});
test('pausing cancels current phrase; resume repeats that phrase without advancing on stale events', () => {
  const f = fixture(); f.start(); const stale = f.spoken[0];
  f.player.pause(); f.clock.tick(1000); stale.onend(); stale.onerror();
  assert.equal(f.player.status, 'paused'); assert.equal(f.spoken.length, 1);
  f.player.resume(); assert.equal(f.spoken[1].text, 'observe');
  stale.onend(); assert.equal(f.player.phase, 'english');
  f.speech.end(); f.clock.tick(10); assert.equal(f.spoken[2].text, '観察する');
});
test('pausing in a gap preserves the remaining delay rather than skipping the translation', () => {
  const f = fixture(); f.start(); f.speech.end(); f.clock.tick(4); f.player.pause();
  f.clock.tick(1000); assert.equal(f.spoken.length, 1);
  f.player.resume(); f.clock.tick(5); assert.equal(f.spoken.length, 1);
  f.clock.tick(1); assert.equal(f.spoken[1].text, '観察する');
});
test('stop and restart invalidate queued gaps and late utterance callbacks', () => {
  const f = fixture(); f.start(); const old = f.spoken[0]; f.speech.end(); f.player.stop(); f.clock.tick(1000);
  assert.equal(f.player.status, 'idle'); assert.equal(f.spoken.length, 1);
  f.start({}, [deck[1]]); old.onend(); old.onerror(); f.clock.tick(25);
  assert.equal(f.spoken.length, 2); assert.equal(f.spoken[1].text, 'assure'); assert.equal(f.player.status, 'playing');
  f.player.stop(); assert.equal(f.clock.tasks.size, 0);
});
test('next and previous cancel old speech and preserve paused state', () => {
  const f = fixture(); f.start(); f.player.move(1);
  assert.equal(f.spoken.at(-1).text, 'assure'); assert.equal(f.player.index, 1);
  f.player.pause(); f.player.move(-1); assert.equal(f.player.status, 'paused');
  f.player.resume(); assert.equal(f.spoken.at(-1).text, 'observe');
  f.player.move(2); assert.equal(f.player.status, 'ended'); assert.equal(f.clock.tasks.size, 0);
});
test('loop repeats only the supplied range and stops cleanly', () => {
  const f = fixture(); f.start({ loop: true }, [deck[1]]);
  f.speech.end(); f.clock.tick(10); f.speech.end(); f.clock.tick(20);
  assert.deepEqual(f.spoken.map(u => u.text), ['assure', '保証する', 'assure']);
  f.player.stop(); f.clock.tick(1000); assert.equal(f.spoken.length, 3);
});
test('missing language, unsupported speech and empty range never silently fall back to another language', () => {
  const f = fixture(); f.speech.getVoices = () => [{ voiceURI: 'en', lang: 'en-US' }];
  assert.throws(() => f.start(), /日本語/); assert.equal(f.spoken.length, 0);
  assert.throws(() => fixture({ speech: undefined, Utterance: null }).start(), /対応/);
  assert.throws(() => fixture().start({}, []), /単語/);
  f.speech.getVoices = () => { throw Error('Device voice service unavailable'); };
  assert.throws(() => f.start(), /英語の音声が見つかりません/);
});
test('speech errors and missing end events stop playback without leaving live timers', () => {
  const f = fixture(); f.start(); f.spoken[0].onerror(); assert.equal(f.player.status, 'error'); assert.equal(f.clock.tasks.size, 0);
  f.start(); f.clock.tick(120000); assert.equal(f.player.status, 'error'); assert.equal(f.clock.tasks.size, 0);
});
