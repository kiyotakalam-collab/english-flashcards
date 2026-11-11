import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const writingKey = 'kotoba_writing_v1';
const vocabulary = {
  ex_flashcards_pwa_v2: JSON.stringify({ schemaVersion: 2, words: [{ id: 'kept-word', word: 'retain', meaning: '保持する', active: true }], records: [{ wordId: 'kept-word', wrongCount: 9, correctCount: 4 }], settings: { feedUrl: '' }, legacyMigrated: true }),
  study_flashcards_mistakes_v1: JSON.stringify([{ word: 'retain', right: 4, wrong: 9 }])
};
const saved = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), writingKey);
const nav = (page, screen) => page.locator(`#navigation [data-page="${screen}"]`).click();

async function open(page) {
  await page.goto('writing.html');
  await expect(page.locator('#app')).not.toBeEmpty();
  await expect.poll(async () => (await saved(page))?.questions.length).toBe(66);
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function downloadJSON(page, button) {
  const pending = page.waitForEvent('download');
  await button.click();
  const stream = await (await pending).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function uploadJSON(input, value) {
  await input.setInputFiles({ name: 'writing-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ vocabulary, writingKey }) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    for (const [key, value] of Object.entries(vocabulary)) {
      if (get.call(localStorage, key) === null) set.call(localStorage, key, value);
    }
    const accesses = [];
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        if (this === localStorage && (![writingKey, 'kotoba_writing_ai_endpoint_v1'].includes(args[0]) || method === 'clear')) accesses.push({ method, key: args[0] ?? null });
        return original.apply(this, args);
      };
    }
    window.writingStorageAudit = () => ({
      accesses: [...accesses],
      vocabulary: Object.fromEntries(Object.keys(vocabulary).map(key => [key, get.call(localStorage, key)]))
    });
  }, { vocabulary, writingKey });
});

for (const width of [360, 393]) {
  test(`six writing screens fit ${width}px without touching vocabulary storage`, async ({ page }) => {
    await page.setViewportSize({ width, height: 851 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await open(page);
    const state = await saved(page);
    expect(state.questions.filter(q => q.mode === 'short')).toHaveLength(62);
    expect(state.questions.filter(q => q.mode === 'essay')).toHaveLength(4);
    expect(state.questions.every(q => q.source === 'original')).toBe(true);
    expect(new Set(state.questions.map(q => q.id)).size).toBe(66);
    expect(state.questions.every(q => q.grammar_tags.length > 0 && q.source_detail)).toBe(true);
    expect(state.textbookProgress).toEqual({ '構文80': { confirmedItems: [1] } });
    for (const screen of ['dashboard', 'short', 'grammar', 'essay', 'review', 'analytics']) {
      await nav(page, screen);
      await expect(page.locator('#app')).not.toBeEmpty();
      await noOverflow(page);
      expect(await page.evaluate(() => window.writingStorageAudit())).toEqual({ accesses: [], vocabulary });
    }
    await page.reload();
    await expect(page.locator('#app')).not.toBeEmpty();
    expect(await page.evaluate(() => window.writingStorageAudit())).toEqual({ accesses: [], vocabulary });
    expect(errors).toEqual([]);
  });
}

test('home exposes writing navigation and returning home preserves writing state', async ({ page }) => {
  await page.goto('./');
  await page.locator('a.writing-entry[href="./writing.html"]').click();
  await expect(page).toHaveURL(/writing\.html/);
  await expect(page.locator('#app')).not.toBeEmpty();
  const before = await saved(page);
  await page.getByRole('link', { name: 'アプリホーム', exact: true }).click();
  await expect(page).toHaveURL(/portal\.html/);
  await page.getByRole('link', { name: /英作文を学習する/ }).click();
  await expect(page.locator('#app')).not.toBeEmpty();
  const after = await saved(page);
  expect(after.answers).toEqual(before.answers);
  expect(after.questions).toEqual(before.questions);
  expect(after.textbookProgress).toEqual(before.textbookProgress);
});

test('starting a new practice clears a previous draft without removing saved answers', async ({ page }) => {
  await open(page);
  await nav(page,'short');
  await page.locator('#session-form [name="difficulty"]').selectOption('basic');
  await page.locator('#session-form').getByRole('button',{name:'新しい練習を開始'}).click();
  await expect(page.locator('#session-form')).toHaveCount(0);
  const firstPrompt = await page.locator('.writing-card .prompt').textContent();
  await page.locator('#answer-input').fill('Previous unsent draft');
  await page.getByRole('button',{name:'練習を終了'}).click();
  await expect(page.locator('#session-form')).toBeVisible();
  await page.locator('#session-form').getByRole('button',{name:'新しい練習を開始'}).click();
  await expect(page.locator('#session-form')).toHaveCount(0);
  await expect(page.locator('#answer-input')).toHaveValue('');
  await expect(page.locator('.writing-card .prompt')).toHaveText(firstPrompt);
  await expect(page.locator('.feedback')).toHaveCount(0);
});

test('AI generation failure still starts and advances through saved questions', async ({ page }) => {
 await open(page);
 await page.evaluate(()=>{
   const endpoint='https://worker.example/grade',access='test-writing-token-'.repeat(3);
   localStorage.setItem('kotoba_writing_ai_endpoint_v1',endpoint);
   sessionStorage.setItem('kotoba_writing_ai_access_v1',JSON.stringify({endpoint,access}));
 });
 await page.reload();
 await page.route('https://worker.example/generate', route=>route.fulfill({status:404,contentType:'application/json',body:'{"error":"not_found"}'}));
 await nav(page,'short');
 await page.locator('#session-form [name="difficulty"]').selectOption('basic');
 await page.locator('#session-form [name="strategy"]').selectOption('ai');
 await page.locator('#session-form [type="submit"]').click();
 await expect(page.locator('#answer-input')).toBeEditable();
 const first=(await saved(page)).session.currentQuestionId;
 await page.locator('[data-action="defer"]').click();
 await expect(page.locator('#answer-input')).toBeEditable();
 const next=(await saved(page)).session.currentQuestionId;
 expect(next).not.toEqual(first);
 await expect(page.locator('.writing-card')).toBeVisible();
});

test('AI question bank adds up to five original questions to selected grammar and difficulty without touching answers', async ({ page }) => {
 await open(page);
 await page.evaluate(()=>{
   const endpoint='https://worker.example/grade',access='test-writing-token-'.repeat(3);
   localStorage.setItem('kotoba_writing_ai_endpoint_v1',endpoint);
   sessionStorage.setItem('kotoba_writing_ai_access_v1',JSON.stringify({endpoint,access}));
 });
 await page.reload();
 let calls=0;
 await page.route('https://worker.example/generate',async route=>{
   if(route.request().method()==='OPTIONS'){
     return route.fulfill({status:204,headers:{'access-control-allow-origin':'http://127.0.0.1:4173',
       'access-control-allow-headers':'Authorization, Content-Type','access-control-allow-methods':'POST, OPTIONS'}});
   }
   calls++;
   const prompt=['海外で生活する人は、異文化への理解を深める。','図書館で働く人は、毎週新しい本を読む。',
     '昨日見た映画は、私に深い印象を残した。','祖父から受け取った時計は、今も動いている。',
     '先生が紹介した作家は、多くの読者に愛されている。'][calls-1];
   const question={japanese:prompt,reference:'A person who lives abroad learns about other cultures.',
     explanation:'関係代名詞で先行詞を修飾します。'};
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},
     body:JSON.stringify({question})});
 });
 await nav(page,'short');
 await page.locator('#bank-form [name="grammar"]').selectOption('relative-pronoun');
 await page.locator('#bank-form [name="difficulty"]').selectOption('basic');
 const before=await saved(page);
 const baseline=before.questions.filter(q=>q.mode==='short'&&q.difficulty==='basic'&&q.grammar_tags.includes('relative-pronoun')).length;
 await page.locator('#bank-form [type="submit"]').click();
 await expect.poll(async()=>((await saved(page)).questions.filter(q=>q.mode==='short'&&q.difficulty==='basic'&&q.grammar_tags.includes('relative-pronoun')).length)).toBe(baseline+5);
 expect(calls).toBe(5);
 const after=await saved(page);
 expect(after.answers).toEqual(before.answers);
 expect(after.questions.filter(q=>q.source_detail?.startsWith('AI生成問題'))).toHaveLength(5);
 await expect(page.locator('#bank-progress')).toContainText(`${baseline+5} / 20`);
});

test('external bank JSON import previews before writing, commits only questions and preserves answers',async({page})=>{
 await open(page);
 const before=await saved(page);
 await page.locator('#manage-open').click();
 const input=page.locator('#bank-import-file');
 const payload={format:'writing-question-bank-v1',questions:[{
   id:'bank-relative-pronoun-basic-001',grammar:'relative-pronoun',difficulty:'basic',
   japanese:'私の父が十年前に建てた小屋は、今も庭に残っている。',
   reference_answers:['The shed which my father built ten years ago is still in our garden.'],
   explanation:'関係代名詞which以下がshedを修飾する。'
 }]};
 await input.setInputFiles({name:'bank.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
 await expect(page.getByText('問題バンクの取り込み確認')).toBeVisible();
 await expect(page.getByText('1問を確定して保存')).toBeVisible();
 expect((await saved(page)).questions).toHaveLength(before.questions.length);
 await page.getByRole('button',{name:'1問を確定して保存'}).click();
 await expect.poll(async()=>(await saved(page)).questions.length).toBe(before.questions.length+1);
 const after=await saved(page);
 expect(after.answers).toEqual(before.answers);
 expect(after.settings).toEqual(before.settings);
 expect(after.textbookProgress).toEqual(before.textbookProgress);
 await page.locator('#manage-open').click();
 await page.locator('#bank-import-file').setInputFiles({name:'bank.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
 await expect(page.getByText('重複スキップ')).toBeVisible();
 await expect(page.getByText('追加なし')).toBeVisible();
 expect((await saved(page)).questions).toHaveLength(before.questions.length+1);
});
test('invalid external bank JSON cannot partially import',async({page})=>{
 await open(page);
 const before=await saved(page);
 await page.locator('#manage-open').click();
 const payload={format:'writing-question-bank-v1',questions:[
  {id:'bank-relative-pronoun-basic-111',grammar:'relative-pronoun',difficulty:'basic',
   japanese:'試験後に私が会った友人は、新しい学校で教えている。',
   reference_answers:['The friend whom I met after the test teaches at a new school.'],
   explanation:'関係代名詞の目的格を確認する。'},
  {id:'bank-relative-pronoun-basic-112',grammar:'nonexistent',difficulty:'basic',
   japanese:'不正な文法分類を意図した設問。',
   reference_answers:['This is invalid.'],explanation:'不正な文法です。'}]};
 await page.locator('#bank-import-file').setInputFiles({name:'bad-bank.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
 await expect(page.getByText('問題バンクの取り込み確認')).toBeVisible();
 await expect(page.getByText('不正・上限超過')).toBeVisible();
 await expect(page.locator('[data-action="bank-import-commit"]')).toHaveCount(0);
 expect((await saved(page)).questions).toHaveLength(before.questions.length);
});
async function begin(page,mode='short') {
 await nav(page,mode);
 // The settings form is intentionally hidden while a session is active.
 // End that session before starting another; existing answers remain saved.
 if (await page.locator('[data-action="end-session"]').count()) {
   await page.locator('[data-action="end-session"]').click();
 }
 await page.locator('#session-form [name="difficulty"]').selectOption(mode==='essay'?'advanced':'basic');
 await page.locator('#session-form [type="submit"]').click();
 await expect(page.locator('#answer-input')).toBeEditable();
}
async function manualGrade(page,status,score,reason='設問と意味・文法を確認した手動評価。') {
 const form=page.locator('#grade-form');await expect(form).toBeVisible();
 await form.locator('[name="status"]').selectOption(status);
 if(await form.locator('[name="score"]').count()) await form.locator('[name="score"]').fill(String(score));
 await form.locator('[name="reason"]').fill(reason);
 await form.locator('[type="submit"]').click();
 await expect(page.locator('#modal')).not.toBeVisible();
}
test('draft resumes, alternate wording can be manually accepted, and duplicate submit saves one event',async({page})=>{
 await open(page);await begin(page);
 const text='My elder sister gave an old map to me.';
 await page.locator('#answer-input').fill(text);
 await expect.poll(async()=>Object.values((await saved(page)).drafts)).toContain(text);
 await page.reload();await expect(page.locator('#answer-input')).toHaveValue(text);
 await page.locator('[data-action="submit"]').evaluate(button=>{button.click();button.click();});
 await expect(page.locator('#grade-form')).toBeVisible();
 expect((await saved(page)).answers).toHaveLength(1);
 await manualGrade(page,'correct',10,'別解ですが、姉・古い地図・私への授与という意味を保ち、文法も妥当です。');
 const state=await saved(page);expect(state.answers[0].evaluation.status).toBe('correct');
 expect(state.answers[0].questionSnapshot.reference_answers).not.toContain(text);
 expect(state.answers[0].mistakeCounted).toBe(false);
 expect(state.textbookProgress).toEqual({'構文80':{confirmedItems:[1]}});
 await page.locator('[data-action="next"]').click();
 await expect(page.locator('#answer-input')).toBeEditable();
 const nextState=await saved(page),q=nextState.questions.find(q=>q.id===nextState.session.currentQuestionId);
 expect(q.grammar_tags).not.toContain('sentence-pattern');
});
test('mistakes survive a later correct answer, grade correction and repeated backup imports',async({page})=>{
 await open(page);await begin(page);
 await page.locator('#answer-input').fill('My sister give me old map.');
 await page.locator('[data-action="submit"]').click();
 await page.locator('#grade-form [name="error"][value="verb-usage"]').check();
 await manualGrade(page,'incorrect',2,'過去のgiveはgave。old mapは冠詞が必要。');
 const first=(await saved(page)).answers[0];expect(first.mistakeCounted).toBe(true);
 await begin(page);await page.locator('#answer-input').fill('My sister gave me an old map.');
 await page.locator('[data-action="submit"]').click();await manualGrade(page,'correct',10);
 let s=await saved(page);expect(s.answers).toHaveLength(2);expect(s.answers.filter(a=>a.mistakeCounted)).toHaveLength(1);
 await page.locator('.feedback [data-action="grade"]').click();await manualGrade(page,'correct',9,'妥当な英文として再確認しました。');
 s=await saved(page);expect(s.answers).toHaveLength(2);expect(s.answers.filter(a=>a.mistakeCounted)).toHaveLength(1);
 await page.locator('#manage-open').click();
 const backup=await downloadJSON(page,page.locator('[data-action="export"]'));
 for(let n=0;n<2;n++){await uploadJSON(page.locator('#writing-import'),backup);await expect(page.locator('#toast')).toContainText('バックアップを統合');}
 s=await saved(page);expect(s.answers).toHaveLength(2);expect(s.answers.filter(a=>a.mistakeCounted)).toHaveLength(1);
 expect(s.answers[1].reviewSchedule.dueAt).toBeTruthy();
});
test('essay rubric, word count and revision chain keep the original argument and history',async({page})=>{
 await open(page);await begin(page,'essay');
 const text='I think dialogue helps students understand different opinions and learn.';
 await page.locator('#answer-input').fill(text);await expect(page.locator('#word-count')).toHaveText('10 words');
 await page.locator('[data-action="submit"]').click();
 await page.locator('#grade-form [name="status"]').selectOption('partial');
 for(const key of ['content','organization','grammar','vocabulary'])await page.locator(`#grade-form [name="rubric-${key}"]`).fill('3');
 await page.locator('#grade-form [name="reason"]').fill('主張は保たれています。具体例と理由のつながりを補います。');
 await page.locator('#grade-form [name="improved"]').fill('I think dialogue helps students understand different perspectives.');
 await page.locator('#grade-form [type="submit"]').click();
 await expect(page.locator('#modal')).not.toBeVisible();
 const first=(await saved(page)).answers[0];expect(first.evaluation.score).toBe(12);expect(first.evaluation.maxScore).toBe(20);
 await page.locator('[data-action="revise"]').click();
 await expect(page.locator('#app')).toContainText('元の主張を保持');
 await page.locator('#answer-input').fill(text+' For example, classmates may explain a different solution.');
 await page.locator('[data-action="submit"]').click();
  await expect(page.locator('#grade-form')).toBeVisible();
 expect((await saved(page)).answers).toHaveLength(2);
 const child=(await saved(page)).answers[1];expect(child.parentAnswerId).toBe(first.id);expect(child.input).toContain(text);
 expect((await saved(page)).answers[0].input).toBe(text);
});
test('invalid external feedback preserves pending answers, and dark mode keeps drafts',async({page})=>{
 await open(page);await begin(page);await page.locator('#answer-input').fill('A draft that must stay here.');
 await page.locator('#theme-toggle').click();await expect(page.locator('body')).toHaveClass('dark');
 await expect(page.locator('#answer-input')).toHaveValue('A draft that must stay here.');
 await page.locator('[data-action="submit"]').click();
 await page.locator('details').filter({has:page.locator('#external-feedback')}).locator('summary').click();
 await page.locator('#external-feedback').fill('{broken');await page.locator('[data-action="external-grade"]').click();
 const s=await saved(page);expect(s.answers).toHaveLength(1);expect(s.answers[0].evaluation.status).toBe('pending');expect(s.answers[0].mistakeCounted).toBe(false);
 await page.reload();await expect(page.locator('#answer-input')).toHaveValue('A draft that must stay here.');
 await expect(page.locator('body')).toHaveClass('dark');
});
test('manual textbook progress is separate and writing works after an offline restart',async({page,context})=>{
 await open(page);await nav(page,'grammar');await page.locator('[data-action="textbook"]').click();
 await page.locator('#textbook-form [name="items"]').fill('1,4');await page.locator('#textbook-form [type="submit"]').click();
 await expect(page.locator('#modal')).not.toBeVisible();
 await begin(page);await page.locator('#answer-input').fill('A saved offline draft.');
 await expect.poll(async()=>Object.values((await saved(page)).drafts)).toContain('A saved offline draft.');
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
 await context.setOffline(true);await page.reload();await expect(page.locator('#answer-input')).toHaveValue('A saved offline draft.');
 expect((await saved(page)).textbookProgress['構文80'].confirmedItems).toEqual([1,4]);
 await page.locator('[data-action="submit"]').click();await manualGrade(page,'correct',10);
 expect((await saved(page)).answers).toHaveLength(1);
 expect((await saved(page)).textbookProgress['構文80'].confirmedItems).toEqual([1,4]);
});
test('problem management adds edits hides and deletes without touching exercise history',async({page})=>{
 await open(page);await page.locator('#manage-open').click();await page.locator('[data-action="new-question"]').click();
 await page.locator('#question-form [name="japanese"]').fill('私は毎朝ここで勉強します。');
 await page.locator('#question-form [name="references"]').fill('I study here every morning.');
 await page.locator('#question-form [name="grammar"][value="tense"]').check();
 await page.locator('#question-form [type="submit"]').click();
 await expect.poll(async()=>(await saved(page)).questions.length).toBe(67);
 let q=(await saved(page)).questions.at(-1);
 await page.locator(`[data-action="edit-question"][data-id="${q.id}"]`).click();
 await page.locator('#question-form [name="japanese"]').fill('私は毎晩ここで勉強します。');
 await page.locator('#question-form [type="submit"]').click();
 await expect.poll(async()=>(await saved(page)).questions.at(-1).japanese).toBe('私は毎晩ここで勉強します。');
 await page.locator(`[data-action="hide-question"][data-id="${q.id}"]`).click();
 await expect.poll(async()=>(await saved(page)).questions.at(-1).active).toBe(false);
 page.once('dialog',dialog=>dialog.accept());await page.locator(`[data-action="delete-question"][data-id="${q.id}"]`).click();
 await expect.poll(async()=>(await saved(page)).questions.at(-1).deleted).toBe(true);
 expect((await saved(page)).answers).toHaveLength(0);
});
test('a wrong answer offers a different context and deferring excludes its grammar for this session',async({page})=>{
 await open(page);await begin(page);const original=(await saved(page)).session.currentQuestionId;
 await page.locator('#answer-input').fill('A mistaken answer.');await page.locator('[data-action="submit"]').click();await manualGrade(page,'incorrect',0);
 await page.locator('[data-action="variant"]').click();
 await expect(page.locator('#answer-input')).toBeEditable();
 const s=await saved(page),variant=s.questions.find(q=>q.id===s.session.currentQuestionId);
 expect(variant.id).not.toBe(original);expect(variant.grammar_tags).toContain('sentence-pattern');
 await page.locator('[data-action="defer"]').click();
 await expect.poll(async()=>(await saved(page)).session.deferredQuestionIds).toContain(variant.id);
 const after=await saved(page);expect(after.session.deferredQuestionIds).toContain(original);expect(after.session.deferredQuestionIds).toContain(variant.id);
 expect(after.session.currentQuestionId).not.toBe(original);
});
test('a vocabulary-only offline worker upgrades to cache writing without erasing drafts',async({page,context})=>{
 let version=1;
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname.replace('/english-flashcards/','')||'index.html';
  try{
   let data=await readFile(new URL(`../../dist/${path}`,import.meta.url));
   if(path==='sw.js'){
    let text=data.toString().replace(/const VERSION = '[^']+'/,`const VERSION = 'writing-migration-${version}'`);
    if(version===1)text=text.replace(/, '\.\/writing[^']*'/g,'');
    data=Buffer.from(text);
   }
   const type=path.endsWith('.js')?'text/javascript':path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'application/json';
   res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base=`http://127.0.0.1:${server.address().port}/english-flashcards/`;
  await page.goto(base);await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});
  version=2;await page.goto(base+'writing.html');await expect(page.locator('#writing-offline')).toHaveText('オフライン利用可');
  await begin(page);await page.locator('#answer-input').fill('This draft survives the worker update.');
  await expect.poll(async()=>Object.values((await saved(page)).drafts)).toContain('This draft survives the worker update.');
  await context.setOffline(true);await page.reload();
  await expect(page.locator('#answer-input')).toHaveValue('This draft survives the worker update.');
 }finally{await context.setOffline(false);await new Promise(resolve=>server.close(resolve));}
});
