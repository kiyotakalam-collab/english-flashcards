import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const stateKey = 'ex_flashcards_pwa_v2';
const legacyKey = 'study_flashcards_mistakes_v1';
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), stateKey);
const settings = page => page.locator('[data-panel="settings"]').click();
const study = page => page.locator('[data-panel="study"]').click();

async function open(page) {
  await page.goto('./');
  await expect(page.locator('#word-count')).toHaveText('308');
}

async function answerFirst(page, correct) {
  const field = correct ? 'correctCount' : 'wrongCount';
  const before = (await saved(page)).records.find(row => row.wordId === 'clumsy')?.[field] || 0;
  await study(page);
  await page.locator('#restart').click();
  await expect(page.locator('#front')).toHaveText('clumsy');
  await page.locator('#card').click();
  await page.locator(correct ? '#correct' : '#wrong').click();
  await expect.poll(async () => (await saved(page)).records.find(row => row.wordId === 'clumsy')?.[field])
    .toBe(before + 1);
}

async function exportBackup(page) {
  await settings(page);
  const pending = page.waitForEvent('download');
  await page.locator('#backup').click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function restore(page, backup) {
  await settings(page);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#restore').setInputFiles({
    name: 'review-backup.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator('#notice')).toContainText('バックアップを取り込みました');
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('legacy migration retains cumulative mistakes after a correct answer and repeat import', async ({ page }) => {
  const oldBackup = [{ word: ' CLUMSY ', meaning: '以前の訳', right: 2, wrong: 8 }];
  await page.addInitScript(({ legacyKey, oldBackup }) => {
    if (!localStorage.getItem(legacyKey)) localStorage.setItem(legacyKey, JSON.stringify(oldBackup));
  }, { legacyKey, oldBackup });
  await open(page);
  expect((await saved(page)).records.find(row => row.wordId === 'clumsy'))
    .toMatchObject({ wrongCount: 8, correctCount: 2 });
  expect((await saved(page)).records[0].answerHistory).toEqual([]);
  await answerFirst(page, true);
  const events = (await saved(page)).records[0].answerHistory;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ result: 'correct', id: expect.any(String), reviewedAt: expect.any(String) });
  await restore(page, oldBackup);
  await restore(page, oldBackup);
  await page.reload();
  await expect(page.locator('#word-count')).toHaveText('308');
  expect((await saved(page)).records.find(row => row.wordId === 'clumsy'))
    .toMatchObject({ wrongCount: 8, correctCount: 3, lastResult: 'correct' });
  expect((await saved(page)).records[0].answerHistory).toEqual(events);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), legacyKey)).toEqual(oldBackup);
});

test('downloaded review backup restores to a fresh browser and repeated restore keeps counters', async ({ page, browser }) => {
  await open(page);
  await answerFirst(page, false);
  await answerFirst(page, true);
  const backup = await exportBackup(page);
  const events = backup.records.find(row => row.wordId === 'clumsy').answerHistory;
  expect(events.map(event => event.result)).toEqual(['wrong', 'correct']);
  expect(new Set(events.map(event => event.id)).size).toBe(2);
  const freshContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
  try {
    const fresh = await freshContext.newPage();
    await fresh.goto(page.url());
    await expect(fresh.locator('#word-count')).toHaveText('308');
    await restore(fresh, backup);
    await restore(fresh, backup);
    await fresh.reload();
    await expect(fresh.locator('#word-count')).toHaveText('308');
    expect((await saved(fresh)).records.find(row => row.wordId === 'clumsy'))
      .toEqual(backup.records.find(row => row.wordId === 'clumsy'));
    await noOverflow(fresh);
  } finally {
    await freshContext.close();
  }
});

test('real service worker retains review state after closing and reopening offline', async ({ page, context }) => {
  await open(page);
  await answerFirst(page, false);
  await settings(page);
  await expect(page.locator('#offline-status')).toContainText('準備ができました');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  const before = await saved(page);
  const appURL = page.url();
  await context.setOffline(true);
  await page.close();
  const restarted = await context.newPage();
  await restarted.goto(appURL);
  await expect(restarted.locator('#word-count')).toHaveText('308');
  await expect(restarted.locator('#connection')).toHaveText('オフライン');
  expect((await saved(restarted)).records).toEqual(before.records);
  await restarted.locator('[data-panel="review"]').click();
  await expect(restarted.locator('#review-days [data-date]')).not.toHaveCount(0);
  await expect(restarted.locator('#review-mastery-sources [data-source="all"] [data-bucket="weak"] .bucket-count')).toHaveText('1');
  await answerFirst(restarted, true);
  await restarted.reload();
  await expect(restarted.locator('#card-wrong')).toContainText('1 回');
  expect((await saved(restarted)).records.find(row => row.wordId === 'clumsy'))
    .toMatchObject({ wrongCount: 1, correctCount: 1, lastResult: 'correct' });
  const history = (await saved(restarted)).records.find(row => row.wordId === 'clumsy').answerHistory;
  expect(history.map(event => event.result)).toEqual(['wrong', 'correct']);
  expect(history[0]).toEqual(before.records.find(row => row.wordId === 'clumsy').answerHistory[0]);
});

for (const width of [360, 393]) {
  test(`calendar and mastery dashboard fit ${width}px and empty days cannot start a session`, async ({ page }) => {
    await page.setViewportSize({ width, height: 851 });
    await open(page);
    await page.locator('[data-panel="review"]').click();
    await expect(page.locator('#review')).toBeVisible();
    await expect(page.locator('#review-due-count')).toHaveText('0');
    await expect(page.locator('#review-start-today')).toBeDisabled();
    await expect(page.locator('#review-start-date')).toBeDisabled();
    await expect(page.locator('#review-mastery-sources [data-source="all"] [data-bucket="new"] .bucket-count')).toHaveText('308');
    await expect(page.locator('#review-mastery-sources [data-source="reading"] .mastery-total')).toHaveText('0 語');
    await expect(page.locator('#review-mastery-sources [data-source="all"] [data-bucket="new"] .bucket-percentage')).toHaveText('100.0%');
    await expect(page.locator('#review-mastery-sources [data-source="reading"] [data-bucket="new"] .bucket-percentage')).toHaveText('0.0%');
    await noOverflow(page);
    const month = await page.locator('#review-month').textContent();
    await page.locator('#review-next').click();
    await expect(page.locator('#review-month')).not.toHaveText(month);
    await noOverflow(page);
    await page.locator('#review-prev').click();
    await expect(page.locator('#review-month')).toHaveText(month);
    await page.locator('#review-source').selectOption('reading');
    await expect(page.locator('#review-due-count')).toHaveText('0');
    await expect(page.locator('#review-start-today')).toBeDisabled();
    await noOverflow(page);
    for (const panel of ['study', 'history', 'settings']) {
      await page.locator(`[data-panel="${panel}"]`).click();
      await noOverflow(page);
    }
  });
}


test('an existing v2 device preserves counters and corrected vocabulary during review migration', async ({ page }) => {
  const words = JSON.parse(await readFile(new URL('../../initial_words.json', import.meta.url), 'utf8'));
  words[0].meaning = '端末で修正済みの訳';
  delete words[0].sources;
  const oldState = {
    schemaVersion: 2, words, legacyMigrated: true,
    records: [{ wordId: 'clumsy', wrongCount: 9, correctCount: 4,
      lastReviewedAt: '2026-11-08T12:00:00.000Z', lastResult: 'wrong' }],
    settings: { feedUrl: '', lastSyncAt: null, lastSyncError: '', lastAdded: 0, pendingDeactivations: [] }
  };
  await page.addInitScript(({ key, oldState }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(oldState));
  }, { key: stateKey, oldState });
  await open(page);
  const migrated = await saved(page);
  expect(migrated.records).toMatchObject(oldState.records);
  expect(migrated.records[0]).toMatchObject({ correctStreak: 0, intervalDays: 0, nextReviewAt: null, answerHistory: [] });
  expect(migrated.words[0]).toMatchObject({ id: 'clumsy', meaning: '端末で修正済みの訳', sources: 'ex' });
  await page.locator('[data-panel="review"]').click();
  await expect(page.locator('#review-mastery-sources [data-source="all"] [data-bucket="recheck"] .bucket-count')).toHaveText('1');
  await expect(page.locator('#review-mastery-sources [data-source="all"] [data-bucket="recheck"] .bucket-percentage')).toHaveText('0.3%');
  await page.reload();
  await expect(page.locator('#word-count')).toHaveText('308');
  expect((await saved(page)).records).toMatchObject(oldState.records);
});

test('shared EX/reading card has one schedule, calendar launch, and overdue review', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-10T03:00:00.000Z'));
  await open(page);
  const feedURL = 'https://sheets.example.test/review-shared';
  await page.route(feedURL, route => route.fulfill({
    contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify([{ id: 'clumsy', word: 'clumsy', meaning: '不器用な', sources: 'ex|reading' }])
  }));
  await settings(page);
  await page.locator('#feed-url').fill(feedURL);
  await page.locator('#sync-form button[type="submit"]').click();
  await expect(page.locator('#sync-status')).toHaveText('同期済み');
  await answerFirst(page, false);
  const wrongState = await saved(page);
  expect(wrongState.records.find(row => row.wordId === 'clumsy')).toMatchObject({
    wrongCount: 1, correctCount: 0, correctStreak: 0,
    nextReviewAt: '2026-11-10T03:10:00.000Z'
  });
  await page.locator('[data-panel="review"]').click();
  await expect(page.locator('#review-due-count')).toHaveText('0');
  await page.locator('#review-days [data-date="2026-11-10"]').click();
  await expect(page.locator('#review-date-count')).toContainText('1');
  await expect(page.locator('#review-date-words')).toContainText('clumsy');
  await page.locator('#review-start-date').click();
  await expect(page.locator('#front')).toHaveText('clumsy');
  await expect(page.locator('#session-context')).toBeVisible();
  await page.locator('#card').click();
  await page.locator('#correct').click();
  await expect(page.locator('#session-done')).toBeVisible();
  const recovered = (await saved(page)).records.find(row => row.wordId === 'clumsy');
  expect(recovered).toMatchObject({ wrongCount: 1, correctCount: 1, correctStreak: 1, intervalDays: 1 });
  await page.locator('[data-panel="review"]').click();
  for (const source of ['all', 'ex', 'reading']) {
    await expect(page.locator(`#review-mastery-sources [data-source="${source}"] [data-bucket="learning"] .bucket-count`)).toHaveText('1');
    await expect(page.locator(`#review-mastery-sources [data-source="${source}"] [data-bucket="learning"] .bucket-percentage`)).toHaveText(source === 'reading' ? '100.0%' : '0.3%');
    await expect(page.locator(`#review-mastery-sources [data-source="${source}"] .mastery-total`)).toHaveText(source === 'reading' ? '1 語' : '308 語');
  }
  await page.clock.setFixedTime(new Date('2026-11-12T03:00:00.000Z'));
  await page.locator('[data-panel="review"]').click();
  for (const source of ['all', 'ex', 'reading']) {
    await page.locator('#review-source').selectOption(source);
    await expect(page.locator('#review-due-count')).toHaveText('1');
    await expect(page.locator('#review-overdue-count')).toContainText('1');
  }
  await page.locator('#review-start-today').click();
  await expect(page.locator('#front')).toHaveText('clumsy');
  await expect(page.locator('#card-source')).toHaveText('準1級EX・長文');
  await page.locator('#card').click();
  await page.locator('#correct').click();
  await expect(page.locator('#session-done')).toBeVisible();
  const state = await saved(page);
  expect(state.words.filter(word => word.id === 'clumsy')).toHaveLength(1);
  expect(state.records.filter(row => row.wordId === 'clumsy')).toHaveLength(1);
  expect(state.records.find(row => row.wordId === 'clumsy')).toMatchObject({
    wrongCount: 1, correctCount: 2, correctStreak: 2, intervalDays: 3,
    nextReviewAt: '2026-11-15T03:00:00.000Z'
  });
});

test('same-day correct answers keep cumulative totals without accelerating spaced progress', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-10T03:00:00.000Z'));
  await open(page);
  await answerFirst(page, true);
  await answerFirst(page, true);
  expect((await saved(page)).records.find(row => row.wordId === 'clumsy')).toMatchObject({
    correctCount: 2, wrongCount: 0, correctStreak: 1, intervalDays: 1,
    nextReviewAt: '2026-11-11T03:00:00.000Z'
  });
  for (const [date, streak, interval] of [
    ['2026-11-11', 2, 3], ['2026-11-14', 3, 7],
    ['2026-11-21', 4, 14], ['2026-12-05', 5, 30]
  ]) {
    await page.clock.setFixedTime(new Date(`${date}T03:00:00.000Z`));
    await answerFirst(page, true);
    expect((await saved(page)).records.find(row => row.wordId === 'clumsy'))
      .toMatchObject({ correctStreak: streak, intervalDays: interval });
  }
  const before = (await saved(page)).records.find(row => row.wordId === 'clumsy');
  await page.reload();
  await expect(page.locator('#word-count')).toHaveText('308');
  expect((await saved(page)).records.find(row => row.wordId === 'clumsy')).toEqual(before);
  await answerFirst(page, false);
  expect((await saved(page)).records.find(row => row.wordId === 'clumsy'))
    .toMatchObject({ correctCount: 6, wrongCount: 1, correctStreak: 0, intervalDays: 0 });
});

test('due list includes overdue but keeps reassessment and future deadlines separate', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-10T03:00:00.000Z'));
  await open(page);
  const fixture = await saved(page);
  const [overdue, dueNow, future, oldWrong] = fixture.words;
  overdue.sources = 'ex|reading';
  const record = (word, reviewedAt, result, nextReviewAt) => ({
    wordId: word.id, correctCount: result === 'correct' ? 1 : 0, wrongCount: result === 'wrong' ? 1 : 0,
    lastReviewedAt: reviewedAt, lastResult: result, answerHistory: [],
    correctStreak: result === 'correct' ? 1 : 0, intervalDays: result === 'correct' ? 1 : 0, nextReviewAt
  });
  fixture.records = [
    record(overdue, '2026-11-08T03:00:00.000Z', 'correct', '2026-11-09T03:00:00.000Z'),
    record(dueNow, '2026-11-10T02:50:00.000Z', 'wrong', '2026-11-10T03:00:00.000Z'),
    record(future, '2026-11-09T04:00:00.000Z', 'correct', '2026-11-10T04:00:00.000Z'),
    { wordId: oldWrong.id, correctCount: 3, wrongCount: 17, lastReviewedAt: null, lastResult: 'wrong' }
  ];
  await restore(page, fixture);
  await page.locator('[data-panel="review"]').click();
  await expect(page.locator('#review-due-count')).toHaveText('2');
  await expect(page.locator('#review-overdue-count')).toContainText('1');
  const recheck = page.locator('#review-mastery-sources [data-source="all"] [data-bucket="recheck"]');
  await expect(recheck.locator('.bucket-count')).toHaveText('1');
  await expect(recheck.locator('.bucket-percentage')).toHaveText('0.3%');
  await expect(page.locator('#review-mastery-sources [data-source="all"] .mastery-total')).toHaveText('308 語');
  await page.locator('#review-show-due').click();
  await expect(page.locator('#review-date-count')).toHaveText('2 語');
  const listed = page.locator('#review-date-words [data-word-id]');
  expect((await listed.evaluateAll(rows => rows.map(row => row.dataset.wordId))).sort())
    .toEqual([overdue.id, dueNow.id].sort());
  await expect(page.locator(`#review-date-words [data-word-id="${oldWrong.id}"]`)).toHaveCount(0);
  await page.locator('#review-source').selectOption('reading');
  await expect(page.locator('#review-due-count')).toHaveText('1');
  await expect(listed).toHaveCount(1);
  await page.locator('#review-source').selectOption('all');
  await page.locator('#review-start-date').click();
  const studied = [];
  for (let i = 0; i < 2; i++) {
    studied.push(await page.locator('#front').textContent());
    await page.locator('#skip').click();
  }
  await expect(page.locator('#session-done')).toBeVisible();
  expect(studied.sort()).toEqual([overdue.word, dueNow.word].sort());
  expect(new Set(studied).size).toBe(2);
});
