import { test, expect } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const key = 'ex_flashcards_pwa_v2', url = 'https://sheets.example.test/feed';
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function open(page) {
  await page.goto('./'); await expect(page.locator('#word-count')).toHaveText('308');
}
async function settings(page) { await page.getByRole('button', { name: '同期・設定', exact: true }).click(); }
async function setupSync(page, body) {
  await page.route(url, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  await settings(page); await page.locator('#feed-url').fill(url);
  await page.getByRole('button', { name: '保存して同期', exact: true }).click();
  await expect(page.locator('#sync-status')).toHaveText('同期済み');
}
test('Android layout, reveal and cumulative grading survive reload; history search and rate', async ({ page }) => {
  await open(page);
  await expect(page.locator('#wrong')).toBeDisabled();
  for (let i = 0; i < 6; i++) {
    await page.locator('#card').click();
    await page.locator(i === 5 ? '#correct' : '#wrong').click();
    await expect(page.locator('#front')).toHaveText('custody');
    await page.locator('#restart').click();
  }
  await page.reload(); await expect(page.locator('#card-wrong')).toContainText('5 回');
  const state = await saved(page);
  expect(state.records[0]).toMatchObject({ wordId: 'clumsy', wrongCount: 5, correctCount: 1, lastResult: 'correct' });
  await expect(page.locator('#accuracy')).toHaveText('16.7');
  await page.getByRole('button', { name: '単語と記録', exact: true }).click();
  await page.locator('#search').fill('clumsy');
  await expect(page.locator('#history-rows tr')).toHaveCount(1);
  await expect(page.locator('#history-rows .history-number')).toHaveText('1');
  await expect(page.locator('#history-rows tr')).toContainText('16.7%');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('starts from a chosen number and stops at the optional ending number', async ({ page }) => {
  await open(page);
  await page.locator('#start-number').fill('101');
  await page.locator('#end-number').fill('103');
  await page.locator('#restart').click();
  await expect(page.locator('#front')).toHaveText('observance');
  await expect(page.locator('#progress')).toContainText('No.101 · 01 / 3');
  await page.locator('#skip').click();
  await expect(page.locator('#front')).toHaveText('assure');
  await page.locator('#skip').click();
  await expect(page.locator('#front')).toHaveText('bleak');
  await page.locator('#skip').click();
  await expect(page.locator('#session-done')).toBeVisible();

  await page.locator('#end-number').fill('');
  await page.locator('#restart').click();
  await expect(page.locator('#progress')).toContainText('01 / 208');
  await page.getByRole('button', { name: '単語と記録', exact: true }).click();
  await page.locator('#search').fill('observance');
  await expect(page.locator('#history-rows .history-number')).toHaveText('101');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('range 101-103 randomizes without repetition and retains original No. and mistake history', async ({ page }) => {
  await open(page);
  // Fixed RNG makes the permutation deterministic, so this checks real shuffling
  // rather than merely checking a set of three possible words.
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator('#start-number').fill('101');
  await page.locator('#end-number').fill('103');
  await page.locator('#order').selectOption('random');
  await expect(page.locator('#front')).toHaveText('assure');
  await expect(page.locator('#progress')).toContainText('No.102 · 01 / 3');
  await page.locator('#card').click();
  await page.locator('#wrong').click();
  await expect(page.locator('#front')).toHaveText('bleak');
  await expect(page.locator('#progress')).toContainText('No.103 · 02 / 3');
  await page.locator('#skip').click();
  await expect(page.locator('#front')).toHaveText('observance');
  await expect(page.locator('#progress')).toContainText('No.101 · 03 / 3');
  await page.locator('#skip').click();
  await expect(page.locator('#session-done')).toBeVisible();
  await page.locator('#restart').click();
  await expect(page.locator('#front')).toHaveText('assure');
  await expect(page.locator('#card-wrong')).toContainText('1 回');
  await page.locator('#order').selectOption('number');
  await expect(page.locator('#front')).toHaveText('observance');
  await expect(page.locator('#progress')).toContainText('No.101 · 01 / 3');
  expect((await saved(page)).records.find(record=>record.wordId==='assure')).toMatchObject({wrongCount:1,correctCount:0});
  await page.reload();
  expect((await saved(page)).records.find(record=>record.wordId==='assure')).toMatchObject({wrongCount:1,correctCount:0});
});

test('random range uses EX or reading numbers independently and preserves missed-word filtering', async ({page}) => {
  await open(page);
  await page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key));
    state.words.push({id:'reading-one',word:'reading-one',meaning:'一',sources:'reading',active:true,range:'',updated_at:''});
    state.words.push({id:'reading-two',word:'reading-two',meaning:'二',sources:'reading',active:true,range:'',updated_at:''});
    localStorage.setItem(key,JSON.stringify(state));
  }, key);
  await page.reload();
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator('#source-filter').selectOption('reading');
  await page.locator('#start-number').fill('1');
  await page.locator('#end-number').fill('2');
  await page.locator('#order').selectOption('random');
  await expect(page.locator('#front')).toHaveText('reading-two');
  await expect(page.locator('#progress')).toContainText('No.2 · 01 / 2');
  await page.locator('#card').click();await page.locator('#wrong').click();
  await expect(page.locator('#front')).toHaveText('reading-one');
  await page.locator('#mode').selectOption('missed');
  await expect(page.locator('#progress')).toContainText('No.2 · 01 / 1');
  await expect(page.locator('#front')).toHaveText('reading-two');
  await page.locator('#mode').selectOption('weak');
  await expect(page.locator('#order')).toBeDisabled();
  await expect(page.locator('#order-help')).toBeVisible();
  await expect(page.locator('#front')).toHaveText('reading-two');
  await page.locator('#mode').selectOption('all');
  await expect(page.locator('#order')).toBeEnabled();
  await expect(page.locator('#order')).toHaveValue('random');
  expect((await saved(page)).records.find(record=>record.wordId==='reading-two').wrongCount).toBe(1);
});

test('history can be sorted by number, cumulative mistakes, and mistake rate', async ({ page }) => {
  await open(page);
  await page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key));
    state.records = [
      { wordId: 'clumsy', correctCount: 8, wrongCount: 2, lastReviewedAt: '2026-11-09T00:00:00.000Z', lastResult: 'correct' },
      { wordId: 'custody', correctCount: 0, wrongCount: 1, lastReviewedAt: '2026-11-09T00:01:00.000Z', lastResult: 'wrong' }
    ];
    localStorage.setItem(key, JSON.stringify(state));
  }, key);
  await page.reload();
  await page.getByRole('button', { name: '単語と記録', exact: true }).click();
  const firstId = () => page.locator('#history-rows tr').first().getAttribute('data-word-id');

  await expect.poll(firstId).toBe('clumsy');
  await page.locator('#history-sort').selectOption('wrong-count');
  await expect.poll(firstId).toBe('clumsy');
  await page.locator('#history-sort').selectOption('wrong-rate');
  await expect.poll(firstId).toBe('custody');
  await page.locator('#history-sort').selectOption('number');
  await expect.poll(firstId).toBe('clumsy');
});
test('live feed additions are idempotent and translation correction retains counters', async ({ page }) => {
  await open(page); await page.locator('#card').click(); await page.locator('#wrong').click();
  const feed = [{ id: 'clumsy', word: 'clumsy', meaning: '不器用な【更新】' }, { id: 'new-word', word: 'new word', meaning: '新しい単語' }];
  await setupSync(page, feed);
  await expect(page.locator('#word-count')).toHaveText('309');
  await page.locator('#sync-now').click();
  await expect(page.locator('#last-added')).toHaveText('0 語');
  expect((await saved(page)).records[0].wrongCount).toBe(1);
  await page.getByRole('button', { name: '学習する', exact: true }).click();
  await page.locator('#restart').click(); await page.locator('#card').click();
  await expect(page.locator('#meaning')).toHaveText('不器用な【更新】');
});
test('failure, malformed feed, reconnection and foreground auto-sync preserve existing history', async ({ page }) => {
  await open(page); await page.locator('#card').click(); await page.locator('#wrong').click();
  await setupSync(page, [{ id: 'added-1', word: 'added one', meaning: '追加1' }]);
  const lastSync = (await saved(page)).settings.lastSyncAt;
  await page.unroute(url);
  await page.route(url, route => route.fulfill({ status: 503, body: 'Unavailable', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.locator('#sync-now').click(); await expect(page.locator('#sync-status')).toContainText('HTTP 503');
  expect((await saved(page)).settings.lastSyncAt).toBe(lastSync);
  await expect(page.locator('#word-count')).toHaveText('309');
  await page.unroute(url);
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<html>Sign in</html>' }));
  await page.locator('#sync-now').click(); await expect(page.locator('#sync-status')).toContainText('公開データ');
  expect((await saved(page)).records[0].wrongCount).toBe(1);
  await page.unroute(url);
  await page.route(url, route => route.fulfill({ contentType: 'text/csv', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'id,word,meaning\nadded-2,added two,追加2\n' }));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#word-count')).toHaveText('310');
  await page.unroute(url);
  await page.route(url, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 'added-3', word: 'added three', meaning: '追加3' }]) }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#word-count')).toHaveText('311');
  await page.reload(); await expect(page.locator('#word-count')).toHaveText('311');
  expect((await saved(page)).records[0].wrongCount).toBe(1);
});
test('same-origin legacy migration and cross-origin JSON import, repeat restore, backup download', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('study_flashcards_mistakes_v1', JSON.stringify([{ word: ' CLUMSY ', meaning: '以前の訳', right: 2, wrong: 8 }])));
  await open(page); await expect(page.locator('#card-wrong')).toContainText('8 回');
  await settings(page);
  page.on('dialog', dialog => dialog.accept());
  const buffer = Buffer.from(JSON.stringify([{ word: 'clumsy', meaning: '訳', right: 4, wrong: 3 }]));
  for (let i = 0; i < 2; i++) {
    await page.locator('#restore').setInputFiles({ name: 'old-backup.json', mimeType: 'application/json', buffer });
    await expect(page.locator('#notice')).toContainText('バックアップを取り込みました');
  }
  expect((await saved(page)).records[0]).toMatchObject({ correctCount: 4, wrongCount: 8 });
  const downloaded = page.waitForEvent('download'); await page.locator('#backup').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/kotoba-backup-.*\.json/);
  const stream = await download.createReadStream(); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = JSON.parse(Buffer.concat(chunks).toString());
  expect(backup.schemaVersion).toBe(2); expect(backup.words.length).toBe(308);
  expect(backup.records[0].wrongCount).toBe(8);
  await page.locator('#restore').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.locator('#notice')).toContainText('取り込めませんでした');
  expect((await saved(page)).records[0].wrongCount).toBe(8);
});
test('deactivation is held until approved, and cancelling keeps card visible', async ({ page }) => {
  await open(page); await page.locator('#card').click(); await page.locator('#wrong').click();
  await setupSync(page, [{ id: 'clumsy', word: 'clumsy', meaning: '不器用な', active: false }]);
  await expect(page.locator('#pending-box')).toBeVisible(); await expect(page.locator('#word-count')).toHaveText('308');
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#approve-inactive').click();
  await expect(page.locator('#word-count')).toHaveText('308');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#approve-inactive').click();
  await expect(page.locator('#word-count')).toHaveText('307');
  const state = await saved(page); expect(state.words[0].active).toBe(false); expect(state.records[0].wrongCount).toBe(1);
  await page.getByRole('button', { name: '単語と記録', exact: true }).click();
  await page.locator('#show-inactive').check(); await page.locator('#search').fill('clumsy');
  await expect(page.locator('#history-rows')).toContainText('非表示');
});
test('real service worker supports offline cold start, grading and fresh-context recovery', async ({ page, context, browser }) => {
  await open(page); await settings(page);
  await expect(page.locator('#offline-status')).toContainText('準備ができました');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  await setupSync(page, [{ id: 'offline-added', word: 'offline added', meaning: '同期済みの単語' }]);
  await context.setOffline(true);
  await page.reload(); await expect(page.locator('#word-count')).toHaveText('309');
  await expect(page.locator('#connection')).toHaveText('オフライン');
  await page.locator('#card').click(); await page.locator('#wrong').click();
  await expect(page.locator('#wrong-count')).toHaveText('1');
  await page.reload(); await expect(page.locator('#card-wrong')).toContainText('1 回');
  const backup = await saved(page);
  const freshContext = await browser.newContext(); const fresh = await freshContext.newPage();
  await fresh.goto('http://127.0.0.1:4173/english-flashcards/');
  await expect(fresh.locator('#word-count')).toHaveText('308'); await settings(fresh);
  fresh.on('dialog', dialog => dialog.accept());
  await fresh.locator('#restore').setInputFiles({ name: 'new-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(fresh.locator('#word-count')).toHaveText('309');
  expect((await saved(fresh)).records[0].wrongCount).toBe(1);
  await freshContext.close();
});
test('refresh helper replaces the app shell without deleting learning history', async ({ page }) => {
  await open(page);
  await page.locator('#card').click(); await page.locator('#wrong').click();
  await expect(page.locator('#wrong-count')).toHaveText('1');
  await page.evaluate(() => navigator.serviceWorker.ready);

  await page.goto('./refresh.html');
  await expect(page.getByRole('heading', { name: 'アプリを最新版に更新' })).toBeVisible();
  await page.getByRole('button', { name: '最新版に更新する' }).click();
  await expect(page).toHaveURL(/\/english-flashcards\/\?updated=\d+$/);
  await expect(page.locator('#word-count')).toHaveText('308');
  await expect(page.locator('#wrong-count')).toHaveText('1');
  await page.evaluate(() => navigator.serviceWorker.ready);
});
test('install manifest resolves project-relative URLs and valid PNG icons', async ({ page, request, browser }) => {
  await open(page);
  const manifestURL = await page.locator('link[rel="manifest"]').evaluate(link => link.href);
  const response = await request.get(manifestURL), manifest = await response.json();
  expect(new URL(manifest.start_url, manifestURL).pathname).toBe('/english-flashcards/');
  expect(new URL(manifest.scope, manifestURL).pathname).toBe('/english-flashcards/');
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, manifestURL).href);
    expect(response.ok()).toBe(true);
    const bytes = await response.body(); expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    const size = Number(icon.sizes.split('x')[0]); expect(bytes.readUInt32BE(16)).toBe(size); expect(bytes.readUInt32BE(20)).toBe(size);
  }
  await settings(page); await expect(page.locator('#offline-status')).toContainText('準備ができました');
  // Incognito contexts prohibit installation. Check a normal persistent profile.
  const profile = await mkdtemp(join(tmpdir(), 'kotoba-install-'));
  const normal = await browser.browserType().launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox']
  });
  try {
    const normalPage = await normal.newPage();
    await normalPage.goto('http://127.0.0.1:4173/english-flashcards/');
    await settings(normalPage); await expect(normalPage.locator('#offline-status')).toContainText('準備ができました');
    const session = await normal.newCDPSession(normalPage);
    const errors = await session.send('Page.getInstallabilityErrors');
    expect(errors.installabilityErrors).toEqual([]);
  } finally { await normal.close(); await rm(profile, { recursive: true, force: true }); }
});
test('a storage failure is shown without advancing or losing saved history', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); }; });
  await page.locator('#card').click(); await page.locator('#wrong').click();
  await expect(page.locator('#notice')).toContainText('端末に保存できません');
  await expect(page.locator('#front')).toHaveText('clumsy');
  expect((await saved(page)).records).toEqual([]);
});
test('two tabs keep each other’s answers through shared storage', async ({ page, context }) => {
  await open(page); const other = await context.newPage(); await open(other);
  await page.locator('#card').click(); await other.locator('#card').click();
  await page.locator('#wrong').click();
  await expect.poll(async () => (await saved(page)).records[0]).toMatchObject({ correctCount: 0, wrongCount: 1 });
  await other.locator('#correct').click();
  await expect.poll(async () => (await saved(page)).records[0]).toMatchObject({ correctCount: 1, wrongCount: 1 });
  await page.reload();
  await expect(page.locator('#wrong-count')).toHaveText('1');
});

test('application update replaces offline assets while preserving history and unrelated caches', async ({ page }) => {
  let version = 1;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname.replace('/english-flashcards/', '') || 'index.html';
    try {
      let body = await readFile(new URL(`../../dist/${path}`, import.meta.url));
      if (path === 'sw.js') body = Buffer.from(body.toString().replace(/const VERSION = '[^']+'/, `const VERSION = 'update-test-${version}'`));
      if (path === 'index.html' && version === 2) body = Buffer.from(body.toString().replace('LITTLE BY LITTLE, EVERY DAY.', 'A LITTLE PROGRESS, EVERY DAY.'));
      const mime = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : path.endsWith('.svg') ? 'image/svg+xml' : 'application/json';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/english-flashcards/`);
    await expect(page.locator('#word-count')).toHaveText('308');
    await page.locator('#card').click(); await page.locator('#wrong').click();
    await expect(page.locator('#wrong-count')).toHaveText('1'); await settings(page);
    await expect(page.locator('#offline-status')).toContainText('準備ができました');
    await page.evaluate(async () => {
      const cache = await caches.open('unrelated-app'); await cache.put('/keep', new Response('keep'));
    });
    version = 2;
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
    await expect(page.locator('#update-app')).toBeVisible();
    await page.locator('#update-app').click();
    await expect(page.locator('.eyebrow')).toHaveText('A LITTLE PROGRESS, EVERY DAY.');
    expect((await saved(page)).records[0].wrongCount).toBe(1);
    expect(await page.evaluate(() => caches.has('unrelated-app'))).toBe(true);
    const cachesAfter = await page.evaluate(() => caches.keys());
    expect(cachesAfter.filter(key => key.startsWith('kotoba-shell:'))).toEqual(['kotoba-shell:/english-flashcards/:update-test-2']);
    await page.context().setOffline(true); await page.reload();
    await expect(page.locator('.eyebrow')).toHaveText('A LITTLE PROGRESS, EVERY DAY.');
    await expect(page.locator('#card-wrong')).toContainText('1 回');
  } finally { await page.context().setOffline(false); await new Promise(resolve => server.close(resolve)); }
});

test('EX/reading selectors share a card and preserve cumulative mistakes on reload', async ({page}) => {
  await open(page);
  await expect(page.locator('#card-source')).toHaveText('準1級EX');
  await page.locator('#source-filter').selectOption('reading');
  await expect(page.locator('#front')).toHaveText('対象の単語はありません');
  await page.locator('#source-filter').selectOption('ex');
  await expect(page.locator('#front')).toHaveText('clumsy');
  await page.locator('#card').click(); await page.locator('#wrong').click();
  await expect(page.locator('#wrong-count')).toHaveText('1');
  await page.evaluate(key => {
    const state = JSON.parse(localStorage.getItem(key));
    const clumsy = state.words.find(word => word.id === 'clumsy');
    clumsy.sources = 'ex|reading';
    state.words.push({id:'from-reading', word:'from-reading', meaning:'長文語', sources:'reading', active:true, range:'', updated_at:''});
    localStorage.setItem(key, JSON.stringify(state));
  }, key);
  await page.reload();
  await expect(page.locator('#word-count')).toHaveText('309');
  await page.locator('#source-filter').selectOption('reading');
  await expect(page.locator('#progress')).toContainText('01 / 2');
  await expect(page.locator('#card-source')).toHaveText('準1級EX・長文');
  await expect(page.locator('#card-wrong')).toContainText('1 回');
  await page.locator('#skip').click();
  await expect(page.locator('#front')).toHaveText('from-reading');
  await expect(page.locator('#card-source')).toHaveText('長文');
  await page.getByRole('button', {name:'単語と記録',exact:true}).click();
  await page.locator('#history-source').selectOption('reading');
  await expect(page.locator('#history-rows tr')).toHaveCount(2);
  await expect(page.locator('#history-rows tr').first()).toContainText('準1級EX・長文');
  await page.locator('#history-source').selectOption('ex');
  await expect(page.locator('#history-rows tr')).toHaveCount(308);
  await expect(page.locator('#history-rows tr').first()).toContainText('1');
  expect((await saved(page)).records.find(r => r.wordId==='clumsy')).toMatchObject({wrongCount:1,correctCount:0});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
