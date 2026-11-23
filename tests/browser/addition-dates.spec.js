import { test, expect } from '@playwright/test';

const key = 'ex_flashcards_pwa_v2', target = '2026-10-31T15:00:00.000Z';
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
async function seed(page) {
  await page.goto('./'); await expect(page.locator('#word-count')).toHaveText('308');
  await page.evaluate(async key => {
    const C = await import('./core.js'); let s = JSON.parse(localStorage.getItem(key));
    s.words[0].added_at = '2026-11-22T15:00:00.000Z';
    s.words[1].added_at = '2026-11-10T00:00:00.000Z';
    s.words[2].added_at = '2026-11-24T00:00:00.000Z';
    s.words[3].added_at = '2026-10-31T16:00:00.000Z'; s.words[5].active = false;
    s = C.recordAnswer(s, s.words[1].id, false); localStorage.setItem(key, JSON.stringify(s));
    localStorage.setItem('kotoba_writing_v1', 'writing-keep'); localStorage.setItem('world-history', 'world-keep');
  }, key);
}
test('explicit date cleanup preserves November 23 and future dates, scores and other learning apps', async ({ page }) => {
  await seed(page); const before = await saved(page); await page.goto('addition-dates.html');
  await expect(page.locator('#preview')).toContainText('変更対象は1語');
  expect(await saved(page)).toEqual(before);
  await page.locator('#apply').evaluate(button => { button.click(); button.click(); });
  await expect(page.locator('#status')).toContainText('1語の追加日を2026年11月1日に');
  const after = await saved(page);
  expect(after.records).toEqual(before.records); expect(after.settings).toEqual(before.settings);
  expect(after.words[0]).toEqual(before.words[0]); expect(after.words[2]).toEqual(before.words[2]); expect(after.words[3]).toEqual(before.words[3]);
  expect(after.words[1].added_at).toBe(target); expect(after.words[5].added_at).toBeUndefined();
  await expect(page.locator('#apply')).toBeDisabled(); await expect(page.locator('#undo')).toBeEnabled();
  expect(await page.evaluate(() => [localStorage.getItem('kotoba_writing_v1'), localStorage.getItem('world-history')])).toEqual(['writing-keep', 'world-keep']);
});
test('undo on the utility never rolls back learning performed after date cleanup', async ({ page }) => {
  await seed(page); const before = await saved(page); await page.goto('addition-dates.html'); await page.locator('#apply').click();
  await expect(page.locator('#status')).toContainText('そろえました');
  await page.evaluate(async key => {
    const C = await import('./core.js'); const s = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(C.recordAnswer(s, s.words[1].id, true)));
  }, key);
  const latest = await saved(page); await page.locator('#undo').click();
  await expect(page.locator('#status')).toContainText('元に戻しました');
  expect((await saved(page)).words).toEqual(before.words); expect((await saved(page)).records).toEqual(latest.records);
});
test('utility works with a stale installed app core and fits a 360px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 851 }); await seed(page);
  await expect(page.locator('#offline-status')).toContainText('準備ができました');
  await page.evaluate(async () => {
    for (const name of await caches.keys()) if (name.startsWith('kotoba-shell:')) {
      const cache = await caches.open(name); await cache.put(new URL('./core.js', location.href), new Response('export const oldCore = true;', { headers: { 'Content-Type': 'application/javascript' } }));
    }
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('addition-dates.html'); await expect(page.locator('#apply')).toBeEnabled(); await page.locator('#apply').click();
  await expect(page.locator('#status')).toContainText('そろえました');
  expect(errors).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('opening from a browser without saved vocabulary makes no data and disables mutation', async ({ page }) => {
  await page.goto('addition-dates.html'); await expect(page.locator('#status')).toContainText('このブラウザーに単語データがありません');
  await expect(page.locator('#apply')).toBeDisabled(); expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(null);
});
test('recovery selects only explicitly chosen words and keeps all scores, future dates and other words', async ({ page }) => {
  await seed(page);
  await page.evaluate(key=>{
    const state=JSON.parse(localStorage.getItem(key));state.words[4].added_at='2026-10-31T15:00:00.000Z';localStorage.setItem(key,JSON.stringify(state));
  },key);
  const before=await saved(page);await page.goto('addition-date-recovery.html');
  expect(await saved(page)).toEqual(before);await expect(page.locator('#save')).toBeDisabled();
  expect(await page.locator('#words input:checked').count()).toBe(0);
  const first=page.locator('#words input').nth(1), second=page.locator('#words input').nth(4);
  await first.check();await second.check();await expect(page.locator('#chosen')).toContainText('選択した2語');
  await expect(page.locator('#words input').nth(0)).toBeDisabled();await expect(page.locator('#words input').nth(2)).toBeDisabled();
  await page.locator('#save').evaluate(button=>{button.click();button.click();});
  await expect(page.locator('#status')).toContainText('2語の追加日を2026年11月23日に');
  const after=await saved(page);expect(after.records).toEqual(before.records);expect(after.settings).toEqual(before.settings);
  for(let i=0;i<before.words.length;i++)expect(after.words[i]).toEqual([1,4].includes(i)?{...before.words[i],added_at:'2026-11-22T15:00:00.000Z'}:before.words[i]);
  await page.evaluate(async key=>{const C=await import('./core.js');const state=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify(C.recordAnswer(state,state.words[1].id,true)));},key);
  const latest=await saved(page);await page.locator('summary').click();await page.locator('#undo-correction').click();
  await expect(page.locator('#status')).toContainText('2語の日付修復を元に戻しました');expect((await saved(page)).words).toEqual(before.words);expect((await saved(page)).records).toEqual(latest.records);
});
test('recovery numbering follows source filter, search never renumbers, and mobile layout works with stale app core', async ({ page }) => {
  await page.setViewportSize({width:360,height:851});await seed(page);
  await page.evaluate(key=>{const s=JSON.parse(localStorage.getItem(key));s.words[1].sources='reading|ex';s.words[4].sources='reading';localStorage.setItem(key,JSON.stringify(s));},key);
  await expect(page.locator('#offline-status')).toContainText('準備ができました');
  await page.evaluate(async()=>{for(const name of await caches.keys())if(name.startsWith('kotoba-shell:')){const cache=await caches.open(name);await cache.put(new URL('./core.js',location.href),new Response('export const oldCore = true;',{headers:{'Content-Type':'application/javascript'}}));}});
  const before=await saved(page),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('addition-date-recovery.html');await page.locator('#source').selectOption('reading');
  await page.locator('#first').fill('2');await page.locator('#last').fill('2');await page.locator('#select-range').click();
  await expect(page.locator('#chosen')).toContainText(before.words[4].word);await expect(page.locator('#chosen')).not.toContainText(before.words[1].word);
  await page.locator('#search').fill(before.words[4].word);await expect(page.locator('#words')).toContainText('No.2');
  await page.locator('#save').click();await expect(page.locator('#status')).toContainText('1語の追加日を2026年11月23日に');
  const after=await saved(page);expect(after.words[4].added_at).toBe('2026-11-22T15:00:00.000Z');expect(after.words[1]).toEqual(before.words[1]);
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('recovery cannot initialize or write when opened in another browser without word data', async ({ page }) => {
  await page.goto('addition-date-recovery.html');await expect(page.locator('#status')).toContainText('このブラウザーに単語データがありません');
  await expect(page.locator('#save')).toBeDisabled();await expect(page.locator('#select-range')).toBeDisabled();expect(await saved(page)).toBeNull();
});
