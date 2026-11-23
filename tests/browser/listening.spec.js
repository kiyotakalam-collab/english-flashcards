import { test, expect } from '@playwright/test';

const key = 'ex_flashcards_pwa_v2';
const saved = page => page.evaluate(key => localStorage.getItem(key), key);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class Utterance { constructor(text) { this.text = text; } }
    const speech = new EventTarget(); let active = null; const old = [];
    window.testVoices = [{ voiceURI: 'local-en', name: 'English local', lang: 'en-US', localService: true },
      { voiceURI: 'local-ja', name: '日本語 local', lang: 'ja-JP', localService: true }];
    window.spoken = [];
    speech.getVoices = () => window.testVoices;
    speech.speak = utterance => { active = utterance; old.push(utterance); window.spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate }); };
    speech.cancel = () => { const cancelled = active; active = null; cancelled?.onend(); };
    window.endSpeech = () => { const utterance = active; active = null; utterance?.onend(); };
    window.lateSpeech = () => old[0]?.onend();
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speech });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  });
});
async function open(page) {
  await page.goto('./'); await expect(page.locator('#word-count')).toHaveText('308');
  await page.locator('[data-panel="listening"]').click();
  await expect(page.locator('#listen-play')).toBeEnabled();
  await page.locator('#listen-translation-delay').selectOption('500');
  await page.locator('#listen-word-delay').selectOption('500');
}
const spoken = page => page.evaluate(() => window.spoken);
const end = page => page.evaluate(() => window.endSpeech());

test('reads exactly the selected No. range English then Japanese and never changes learning storage', async ({ page }) => {
  await open(page); const before = await saved(page), state = JSON.parse(before);
  await page.locator('#listen-start').fill('101'); await page.locator('#listen-end').fill('102');
  await page.locator('#listen-rate').selectOption('1.25'); await page.locator('#listen-play').click();
  await expect(page.locator('#listen-progress')).toContainText('No.101 · 1 / 2');
  expect((await spoken(page))[0]).toEqual({ text: state.words[100].word, lang: 'en-US', rate: 1.25 });
  await end(page); await expect.poll(async () => (await spoken(page)).length).toBe(2);
  expect((await spoken(page))[1].text).toBe(state.words[100].meaning);
  expect((await spoken(page))[1].lang).toBe('ja-JP');
  await end(page); await expect(page.locator('#listen-progress')).toContainText('No.102 · 2 / 2');
  await end(page); await expect.poll(async () => (await spoken(page)).length).toBe(4); await end(page);
  await expect(page.locator('#listen-status')).toContainText('終了しました');
  expect(await saved(page)).toBe(before);
});
test('pause/resume, stale callbacks, next/previous and stop cannot produce overlapping queues', async ({ page }) => {
  await open(page); await page.locator('#listen-end').fill('2'); await page.locator('#listen-play').click();
  await page.locator('#listen-pause').click(); await page.evaluate(() => window.lateSpeech());
  await expect(page.locator('#listen-status')).toContainText('一時停止中'); expect((await spoken(page)).length).toBe(1);
  await page.locator('#listen-pause').click(); expect((await spoken(page))[1].text).toBe('clumsy');
  await page.locator('#listen-next').click(); await expect(page.locator('#listen-word')).toHaveText('custody');
  await page.locator('#listen-prev').click(); await expect(page.locator('#listen-word')).toHaveText('clumsy');
  await page.locator('#listen-stop').click(); await page.evaluate(() => window.lateSpeech());
  await expect(page.locator('#listen-status')).toHaveText('再生待ち'); await expect(page.locator('#listen-pause')).toBeDisabled();
});
test('source-relative range and unlearned filter work with loop without touching shared history', async ({ page }) => {
  await open(page);
  await page.evaluate(async key => {
    const C = await import('./core.js'); let s = JSON.parse(localStorage.getItem(key));
    s = C.upsertWords(s, [{ ...s.words[0], sources: 'ex|reading' }, { id: 'reading-a', word: 'reading-a', meaning: '訳A', sources: 'reading' }, { id: 'reading-b', word: 'reading-b', meaning: '訳B', sources: 'reading' }]).state;
    s = C.recordAnswer(s, s.words[0].id, true); localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await page.reload(); await page.locator('[data-panel="listening"]').click(); const before = await saved(page);
  await page.locator('#listen-source').selectOption('reading'); await page.locator('#listen-mode').selectOption('unlearned');
  await page.locator('#listen-start').fill('2'); await page.locator('#listen-end').fill('2');
  await page.locator('#listen-translation-delay').selectOption('500'); await page.locator('#listen-word-delay').selectOption('500');
  await page.locator('#listen-loop').check(); await page.locator('#listen-play').click();
  await expect(page.locator('#listen-progress')).toContainText('No.2 · 1 / 1');
  await end(page); await expect.poll(async () => (await spoken(page)).length).toBe(2);
  await end(page); await expect.poll(async () => (await spoken(page)).length).toBe(3);
  expect((await spoken(page)).map(u => u.text)).toEqual(['reading-a', '訳A', 'reading-a']);
  await page.locator('#listen-stop').click(); expect(await saved(page)).toBe(before);
});
test('late-arriving voices populate controls and missing Japanese voice reports a useful error', async ({ page }) => {
  await open(page); await page.evaluate(() => { window.testVoices = window.testVoices.filter(v => v.lang.startsWith('en')); window.speechSynthesis.dispatchEvent(new Event('voiceschanged')); });
  await page.locator('#listen-play').click(); await expect(page.locator('#listen-status')).toContainText('日本語の音声が見つかりません');
  expect(await spoken(page)).toEqual([]);
  await page.evaluate(() => { window.testVoices.push({ voiceURI: 'new-ja', lang: 'ja-JP', name: '追加の日本語', localService: true }); window.speechSynthesis.dispatchEvent(new Event('voiceschanged')); });
  await page.locator('#listen-ja-voice').selectOption('new-ja'); await page.locator('#listen-end').fill('1');
  await page.locator('#listen-play').click(); await expect(page.locator('#listen-status')).toContainText('英語を読み上げ');
});
test('today-only listening uses recorded additions and leaves all learning data intact', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T15:10:00Z')); await open(page);
  await page.evaluate(async key => {
    const C = await import('./core.js'); let s = JSON.parse(localStorage.getItem(key));
    s = C.upsertWords(s, [{ id: 'old-read', word: 'old-read', meaning: '前日', sources: 'reading' }], '2026-11-22T14:00:00Z').state;
    s = C.upsertWords(s, [{ id: 'new-read', word: 'new-read', meaning: '今日', sources: 'reading' }], '2026-11-22T15:00:00Z').state;
    localStorage.setItem(key, JSON.stringify(s));
  }, key);
  await page.reload(); await page.locator('[data-panel="listening"]').click(); const before = await saved(page);
  await page.locator('#listen-source').selectOption('reading'); await page.locator('#listen-end').fill('2'); await page.locator('#listen-mode').selectOption('today');
  await page.locator('#listen-play').click(); await expect(page.locator('#listen-word')).toHaveText('new-read');
  await expect(page.locator('#listen-progress')).toContainText('No.2 · 1 / 1');
  await page.locator('#listen-stop').click(); expect(await saved(page)).toBe(before);
});
test('cached listening modules start offline and retain all saved learning records', async ({ page, context }) => {
  await open(page); await expect(page.locator('#offline-status')).toContainText('準備ができました'); const before = await saved(page);
  await context.setOffline(true); await page.reload(); await page.locator('[data-panel="listening"]').click();
  await page.locator('#listen-start').fill('2'); await page.locator('#listen-end').fill('2'); await page.locator('#listen-play').click();
  await expect(page.locator('#listen-word')).toHaveText('custody'); expect((await spoken(page))[0].lang).toBe('en-US');
  await page.locator('#listen-stop').click(); expect(await saved(page)).toBe(before);
});
test('hiding the screen pauses safely and returning requires explicit resume', async ({ page }) => {
  await open(page); const before = await saved(page); await page.locator('#listen-play').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#listen-status')).toContainText('画面が非表示');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.lateSpeech();
  });
  expect((await spoken(page)).length).toBe(1);
  await page.locator('#listen-pause').click(); expect((await spoken(page))[1].text).toBe('clumsy');
  expect(await saved(page)).toBe(before);
});
for (const width of [360, 393]) test(`listening controls and tabs fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 851 }); await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#listen-start')).toBeVisible(); await expect(page.locator('#listen-end')).toBeVisible();
});
