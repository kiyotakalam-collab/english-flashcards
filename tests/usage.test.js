import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../usage-core.js';
import { INITIAL_ITEMS, CATEGORIES } from '../usage-data.js';
const now = '2026-11-27T03:00:00.000Z';
const ctx = s => ({ sessionId: s.session.id, index: s.session.index, now });
function answer(s, correct) { const q = C.currentQuestion(s); return C.submitAnswer(s, correct ? q.English : 'wrong answer', ctx(s)); }
function storage(value = null) {
  const map = new Map([['world-history', 'keep'], ['ex_flashcards_pwa_v2', 'vocabulary-keep'], ['kotoba_writing_v1', 'writing-keep']]);
  if (value) map.set(C.STATE_KEY, JSON.stringify(value));
  return { map, getItem: key => map.get(key) ?? null, setItem: (key, v) => map.set(key, v) };
}
test('20 specified originals have stable IDs, simple examples and all required metadata', () => {
  assert.equal(INITIAL_ITEMS.length, 20); assert.equal(new Set(INITIAL_ITEMS.map(q=>q.id)).size,20);
  const s = C.initialState(); assert.doesNotThrow(()=>C.validateState(s));
  assert.equal(s.items[0].English, 'be distracted by A'); assert.equal(s.items[18].English,'be aware that S V');
  assert.equal(s.items[19].example,'Plastic waste can damage the environment.');
  for(const item of s.items){assert(CATEGORIES.includes(item.category));assert.equal(item.active,true);assert(item.Japanese&&item.English&&item.example&&item.created_at&&item.updated_at);}
});
test('grading ignores only presentation and declared placeholders, not grammar or articles', () => {
  for(const value of ['be distracted by A',' BE DISTRACTED BY a.  ','be　 distracted　by　～.','be distracted by 人','be distracted by もの','be distracted by something']) assert(C.gradeAnswer(value,'be distracted by A'),value);
  for(const [actual,expected] of [['be available for A','be available to A'],['be distract by A','be distracted by A'],['be by distracted A','be distracted by A'],['spend time to do','spend time doing'],['a substitute A','a substitute for A'],['～ substitute for A','a substitute for A'],['be. distracted by A','be distracted by A'],['','get sick'],['keep healthy A','keep A healthy']]) assert.equal(C.gradeAnswer(actual,expected),false,actual);
  assert(C.gradeAnswer('A SUBSTITUTE FOR ～.','a substitute for A')); assert(C.gradeAnswer('be aware that s v.','be aware that S V'));
});
test('duplicate expressions cannot be registered by changing placeholders, case, spacing, inactive status or editing', () => {
  let s=C.initialState();
  for(const English of ['BE DISTRACTED BY ～.','be　 distracted by 人','be distracted by a']) assert.throws(()=>C.saveItem(s,{Japanese:'重複',English,example:'Example.',category:'その他'}),/同じ語法/);
  s=C.saveItem(s,{...s.items[0],active:false},{now});
  assert.throws(()=>C.saveItem(s,{Japanese:'重複',English:'be distracted by もの',example:'Example.',category:'その他'}),/同じ語法/);
  assert.throws(()=>C.saveItem(s,{...s.items[1],English:'be distracted by ～'}),/同じ語法/);
  const added=C.saveItem(s,{Japanese:'Aを頼りにする',English:'rely on A',example:'You can rely on me.',category:'動詞語法'},{id:'custom',now});
  assert.equal(added.items.length,21); const edited=C.saveItem(added,{...added.items.at(-1),Japanese:'Aに頼る'},{now:'2026-11-28T00:00:00Z'});
  assert.equal(edited.items.at(-1).id,'custom');assert.equal(edited.items.at(-1).created_at,now);assert.equal(edited.items.at(-1).Japanese,'Aに頼る');
});
test('test counts, categories and inactive filters choose without replacement and leave originals in order', () => {
  const original=C.initialState(), order=original.items.map(q=>q.id);
  for(const count of ['10','20','30','all']){
    const s=C.startTest(original,{count,rng:()=>0});assert.equal(s.session.queue.length,count==='10'?10:20);assert.equal(new Set(s.session.queue).size,s.session.queue.length);assert.deepEqual(s.items.map(q=>q.id),order);assert.notDeepEqual(s.session.queue,order.slice(0,s.session.queue.length));
  }
  original.items[0].active=false; const filtered=C.startTest(original,{count:'all',category:'動詞語法'});
  assert(filtered.tests[0].questions.every(q=>q.category==='動詞語法'&&q.active&&q.id!==original.items[0].id));
  assert.throws(()=>C.startTest(original,{category:'前置詞'}),/出題できる語法/);
});
test('test-only mistakes are isolated from old tests and review removes correct items until completion without erasing errors', () => {
  let s=C.startTest(C.initialState(),{count:'10',id:'first',now,rng:()=>0.4});
  for(let i=0;i<10;i++){s=answer(s,i!==0&&i!==2);s=C.nextQuestion(s,ctx(s));}
  const first=s.tests[0]; assert.equal(first.wrongIds.length,2);assert.equal(first.reviewRemainingIds.length,2);
  s=C.startReview(s,{id:'review-first',rng:()=>0.4});const firstId=C.currentQuestion(s).id;
  s=answer(s,false);s=C.nextQuestion(s,ctx(s));s=answer(s,true);
  assert.equal(s.tests[0].reviewRemainingIds.length,1);s=C.nextQuestion(s,ctx(s));assert.equal(C.currentQuestion(s).id,firstId);
  s=answer(s,true);s=C.nextQuestion(s,ctx(s));assert.equal(s.session.phase,'complete');assert.equal(s.tests[0].reviewRemainingIds.length,0);
  assert.equal(s.attempts.filter(a=>!a.correct).length,3);assert.equal(s.tests[0].wrongIds.length,2);
  s=C.startTest(s,{count:'10',id:'second',now:'2026-11-28T00:00:00Z'});
  for(let i=0;i<10;i++){s=answer(s,i!==1);s=C.nextQuestion(s,ctx(s));}
  s=C.startReview(s,{id:'review-second'});
  assert.deepEqual(s.session.queue,s.tests[1].wrongIds);assert.equal(s.session.queue.length,1);assert.equal(s.tests[0].wrongIds.length,2);
  assert.doesNotThrow(()=>C.validateState(s));
});
test('repeated submit/next and stale drafts cannot duplicate history or alter the next question', () => {
  let s=C.startTest(C.initialState(),{id:'double'}), context=ctx(s);
  s=C.saveDraft(s,'be ',context.sessionId,context.index);assert.equal(s.session.draft,'be ');
  s=answer(s,false);s=C.submitAnswer(s,'other',context);assert.equal(s.attempts.length,1);
  const feedback=s.attempts[0];s=C.nextQuestion(s,context);const index=s.session.index;
  s=C.nextQuestion(s,context);s=C.saveDraft(s,'stale',context.sessionId,context.index);s=C.submitAnswer(s,'stale',context);
  assert.equal(s.attempts.length,1);assert.equal(s.session.index,index);assert.equal(s.session.draft,'');assert.deepEqual(s.attempts[0],feedback);
  const item=s.items.find(q=>q.id===C.currentQuestion(s).id);s=C.saveItem(s,{...item,English:'another expression',active:false},{now});
  assert.notEqual(C.currentQuestion(s).English,'another expression');
});
test('persistent draft, test and review state survive restart; backups are idempotent and independent', async () => {
  const store=storage();let s=C.initializeState(store);assert.equal(s.items.length,20);
  s=await C.transact(store,x=>C.startTest(x,{id:'saved'}));s=await C.transact(store,x=>C.saveDraft(x,'unfinished answer',s.session.id,0));
  assert.equal(C.initializeState(store).session.draft,'unfinished answer');
  s=await C.transact(store,x=>answer(x,false));assert.equal(C.initializeState(store).session.phase,'feedback');
  const backup=C.exportBackup(s);let restored=C.restoreBackup(C.initialState(),backup);restored=C.restoreBackup(restored,backup);
  assert.equal(restored.attempts.length,1);assert.equal(restored.tests.length,1);assert.deepEqual(restored.session,s.session);
  for(const key of ['world-history','ex_flashcards_pwa_v2','kotoba_writing_v1'])assert.equal(store.getItem(key),key==='world-history'?'keep':key==='ex_flashcards_pwa_v2'?'vocabulary-keep':'writing-keep');
  assert.throws(()=>C.restoreBackup(s,{format:'word-backup'}));
  const before=store.getItem(C.STATE_KEY);store.setItem=()=>{throw Error('quota');};
  await assert.rejects(C.transact(store,x=>answer(x,true)),/quota/);assert.equal(store.getItem(C.STATE_KEY),before);
});
test('corrupt saved state is never replaced with fresh defaults', () => {
  const store=storage();store.map.set(C.STATE_KEY,'broken json');assert.throws(()=>C.initializeState(store));assert.equal(store.getItem(C.STATE_KEY),'broken json');
  store.map.set(C.STATE_KEY,JSON.stringify({schemaVersion:99}));assert.throws(()=>C.initializeState(store));assert.equal(JSON.parse(store.getItem(C.STATE_KEY)).schemaVersion,99);
});
test('importing a newer copy of the same test advances its session rather than leaving an unanswerable duplicate slot', () => {
  const old=C.startTest(C.initialState(),{id:'same-test'}),newer=answer(old,false);
  const restored=C.restoreBackup(old,C.exportBackup(newer));
  assert.equal(restored.session.phase,'feedback');assert.equal(restored.attempts.length,1);
  const next=C.nextQuestion(restored,ctx(restored));assert.equal(next.session.index,1);assert.equal(answer(next,true).attempts.length,2);
  const again=C.restoreBackup(next,C.exportBackup(old));assert.equal(again.session.index,1);assert.equal(again.attempts.length,1);
});
