import { test, expect } from '@playwright/test';
const key = 'kotoba_usage_v1';
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const question = state => state.tests.find(t => t.id === state.session.testId).questions.find(q => q.id === state.session.queue[state.session.index]);
async function open(page) { await page.goto('usage.html'); await expect(page.locator('#item-count')).toHaveText('20'); }
async function start(page) { await page.locator('#start').click(); await expect(page.locator('#answer-input')).toBeEditable(); }
async function grade(page, text) { await page.locator('#answer-input').fill(text); await page.locator('#answer-input').press('Enter'); await expect(page.locator('#feedback')).toBeVisible(); }
async function next(page) { await page.locator('#next').click(); await expect.poll(async () => (await saved(page)).session.phase).not.toBe('feedback'); }
async function review(page) { await page.locator('#review').click(); await expect.poll(async () => (await saved(page)).session.mode).toBe('review'); await expect(page.locator('#answer-input')).toBeEditable(); }

test('home, vocabulary and writing provide real links to the independent usage mode', async ({ page }) => {
  await page.goto('portal.html');await expect(page.locator('a[href="./usage.html"]')).toBeVisible();await page.locator('a[href="./usage.html"]').click();await expect(page.locator('h1')).toContainText('使える形');
  await page.goto('writing.html');await expect(page.locator('a[href="usage.html"]')).toBeVisible();
  await page.goto('./');await expect(page.locator('a[href="./usage.html"]')).toBeVisible();
});
test('Japanese only before answering; strict preposition grading, cosmetic variants and keyboard-only next', async ({ page }) => {
  await open(page);
  await page.evaluate(key=>{const s=JSON.parse(localStorage.getItem(key));for(const q of s.items)q.active=q.id==='usage-006';localStorage.setItem(key,JSON.stringify(s));},key);
  await page.reload();await start(page);await expect(page.locator('#question-japanese')).toHaveText('Aが利用できる');
  await expect(page.locator('#exercise')).not.toContainText('be available');await expect(page.locator('#exercise')).not.toContainText('This service');
  await grade(page,'be available for A');await expect(page.locator('.verdict')).toHaveText('不正解');await expect(page.locator('#feedback')).toContainText('be available to A');await expect(page.locator('#feedback')).toContainText('This service is available to students.');
  await page.locator('#next').press('Enter');await expect(page.locator('#exercise')).toContainText('今回のテスト結果');await review(page);
  await grade(page,'  BE　AVAILABLE　TO　～.  ');await expect(page.locator('.verdict')).toHaveText('正解');await next(page);await expect(page.locator('#exercise')).toContainText('誤答復習が完了');await expect(page.locator('#wrong-count')).toHaveText('1');
});
test('only this test mistakes repeat until correct; older errors never leak into the next review set', async ({ page }) => {
  test.setTimeout(60000);await open(page);await start(page);
  for(let i=0;i<10;i++){const q=question(await saved(page));await grade(page,i<2?'wrong':q.English);await next(page);}
  await expect(page.locator('#review-summary')).toContainText('10問中 2問に誤答');await review(page);
  const first=question(await saved(page));await grade(page,'wrong again');await next(page);
  await grade(page,question(await saved(page)).English);await next(page);
  expect(question(await saved(page)).id).toBe(first.id);await expect(page.locator('#review-summary')).toContainText('1問');
  await grade(page,first.English);await next(page);await expect(page.locator('#review')).toBeDisabled();await expect(page.locator('#exercise')).toContainText('誤答復習が完了');await expect(page.locator('#wrong-count')).toHaveText('3');
  await start(page);for(let i=0;i<10;i++){await grade(page,i===0?'wrong':question(await saved(page)).English);await next(page);}
  await review(page);const s=await saved(page);expect(s.session.queue).toEqual(s.tests[1].wrongIds);expect(s.session.queue).toHaveLength(1);expect(s.tests[0].wrongIds).toHaveLength(2);
});
test('manager adds and edits original expressions, rejects duplicates including inactive variants, and safely renders text', async ({ page }) => {
  await open(page);await page.locator('[data-page="items"]').click();
  const fill=async English=>{await page.locator('#japanese').fill('Aを頼りにする <img src=x>');await page.locator('#english').fill(English);await page.locator('#example').fill('You can rely on me.');await page.locator('#item-category').selectOption('動詞語法');};
  await fill('rely on A');await page.locator('#save-item').click();await expect(page.locator('#item-count')).toHaveText('21');
  await fill('RELY　ON　～.');await page.locator('#save-item').click();await expect(page.locator('#notice')).toContainText('同じ語法');expect((await saved(page)).items.length).toBe(21);
  await page.locator('#cancel-edit').click();await page.locator('#item-search').fill('rely');await page.locator('[data-edit]').click();await page.locator('#active').uncheck();await page.locator('#save-item').click();await expect(page.locator('#item-count')).toHaveText('20');
  await fill('rely on 人');await page.locator('#save-item').click();await expect(page.locator('#notice')).toContainText('同じ語法');expect(await page.locator('#item-list img').count()).toBe(0);
});
for(const width of [360,393])test(`mobile ${width}px: all screens fit; draft persists; other applications are neither read nor written`, async ({page})=>{
  await page.setViewportSize({width,height:851});
  await page.addInitScript(key=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem,keys=['ex_flashcards_pwa_v2','kotoba_writing_v1','world-history','year-master'];
    for(const k of keys)if(get.call(localStorage,k)===null)set.call(localStorage,k,'keep-'+k);
    const accesses=[];for(const method of ['getItem','setItem','removeItem','clear','key']){const original=Storage.prototype[method];Storage.prototype[method]=function(...args){if(this===localStorage&&(args[0]!==key||method==='clear'))accesses.push([method,args[0]]);return original.apply(this,args);};}
    window.usageAudit=()=>({accesses,values:keys.map(k=>get.call(localStorage,k))});
  },key);
  await open(page);await start(page);await page.locator('#answer-input').fill('my unfinished answer');
  await expect.poll(async()=>(await saved(page)).session.draft).toBe('my unfinished answer');await page.reload();await expect(page.locator('#answer-input')).toHaveValue('my unfinished answer');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const screen of ['items','history','study']){await page.locator(`[data-page="${screen}"]`).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  expect(await page.evaluate(()=>window.usageAudit())).toEqual({accesses:[],values:['keep-ex_flashcards_pwa_v2','keep-kotoba_writing_v1','keep-world-history','keep-year-master']});expect(errors).toEqual([]);
  await page.screenshot({path:`/tmp/usage-${width}.png`,fullPage:true});
});
test('offline cold restart resumes and grades without an API; JSON restore never doubles answers', async ({page,context})=>{
  await open(page);await expect(page.locator('#offline-status')).toContainText('準備ができました');await start(page);await grade(page,'wrong');
  await page.locator('[data-page="history"]').click();const pending=page.waitForEvent('download');await page.locator('#export').click();const download=await pending;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const backup=Buffer.concat(chunks);
  for(let i=0;i<2;i++){await page.locator('#import').setInputFiles({name:'usage.json',mimeType:'application/json',buffer:backup});await expect(page.locator('#notice')).toContainText('取り込みました');await expect(page.locator('#import')).toHaveValue('');}
  expect((await saved(page)).attempts).toHaveLength(1);
  await context.setOffline(true);await page.goto('portal.html');await page.locator('a[href="./usage.html"]').click();await expect(page.locator('#feedback')).toContainText('不正解');await next(page);await grade(page,question(await saved(page)).English);await expect(page.locator('.verdict')).toHaveText('正解');expect((await saved(page)).attempts).toHaveLength(2);
});
test('failed writes keep the draft and history intact; retry and double-submit produce exactly one answer', async ({page})=>{
  await open(page);await start(page);await page.locator('#answer-input').fill('draft preserved');await expect.poll(async()=>(await saved(page)).session.draft).toBe('draft preserved');
  await page.evaluate(key=>{const write=Storage.prototype.setItem;window.failUsageWrites=true;Storage.prototype.setItem=function(k,v){if(k===key&&window.failUsageWrites)throw Error('quota');return write.call(this,k,v);};},key);
  await page.locator('#grade').click();await expect(page.locator('#notice')).toContainText('回答を保存できませんでした');expect((await saved(page)).attempts).toHaveLength(0);await expect(page.locator('#answer-input')).toHaveValue('draft preserved');
  await page.evaluate(()=>window.failUsageWrites=false);await page.locator('#answer-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await expect(page.locator('#feedback')).toBeVisible();expect((await saved(page)).attempts).toHaveLength(1);
});
test('malformed storage displays a recoverable error without resetting any data', async ({page})=>{
  await page.addInitScript(key=>localStorage.setItem(key,'not-json'),key);await page.goto('usage.html');await expect(page.locator('#fatal')).toContainText('初期化していません');await expect(page.locator('#start')).toBeDisabled();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('not-json');
});
test('an installed old shell shows the update action before claiming offline readiness for the new mode', async ({page,context})=>{
  await context.route('**/sw.js',route=>route.fulfill({contentType:'text/javascript',body:"self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));"}));
  await page.goto('portal.html');
  await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.unroute('**/sw.js');await open(page);
  await expect(page.locator('#update-app')).toBeVisible();await expect(page.locator('#offline-status')).toContainText('最新版に更新すると');
  await start(page);await page.locator('#answer-input').fill('keep my draft');await expect.poll(async()=>(await saved(page)).session.draft).toBe('keep my draft');
  await page.locator('#update-app').click();await expect(page.locator('#offline-status')).toContainText('準備ができました');await expect(page.locator('#answer-input')).toHaveValue('keep my draft');
  await context.setOffline(true);await page.reload();await expect(page.locator('#answer-input')).toHaveValue('keep my draft');
});
test('a second tab advancing the session cannot leave an old prompt attached to the next answer', async ({page,context})=>{
  await open(page);await start(page);const other=await context.newPage();await other.goto('usage.html');await expect(other.locator('#answer-input')).toBeEditable();
  await page.locator('#answer-input').fill('first question draft');await expect.poll(async()=>(await saved(page)).session.draft).toBe('first question draft');
  await grade(other,question(await saved(other)).English);await next(other);
  const q=question(await saved(other));await expect(page.locator('#question-japanese')).toHaveText(q.Japanese);await expect(page.locator('#answer-input')).toHaveValue('');
  await grade(page,q.English);expect((await saved(page)).attempts).toHaveLength(2);expect((await saved(page)).attempts.every(a=>a.correct)).toBe(true);
});
