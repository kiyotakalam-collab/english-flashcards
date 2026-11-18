import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import * as Core from '../writing-core.js';
import {QUESTIONS,GRAMMAR,DIFFICULTIES} from '../writing-data.js';
import {WRITING_BANK_RELEASE} from '../writing-bank-manifest.js';
import {loadBundledQuestions,reconcileBundledQuestions,initializeBundledBank} from '../writing-bank-loader.js';
import {bankCount,isSimilarPrompt,createPromptIndex} from '../writing-bank.js';
const fetcher=async url=>({ok:true,text:()=>readFile(url,'utf8')});
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};

test('all 124 cells are audited and completed categories have exactly twenty per level',async()=>{
 const qs=await loadBundledQuestions(QUESTIONS,{fetcher}),state=Core.createState(qs);
 assert.equal(qs.filter(q=>q.mode==='short').length,WRITING_BANK_RELEASE.shortCount);
 assert.equal(new Set(qs.map(q=>q.id)).size,qs.length);
 const index=createPromptIndex();
 for(const q of qs){assert.equal(index.has(q.japanese),false,q.id);index.add(q.japanese);assert.ok(q.explanation.trim());assert.ok(q.mode==='essay'||q.reference_answers.length);}
 for(const g of GRAMMAR)for(const d of DIFFICULTIES){const count=bankCount(state,g.id,d.id);assert.ok(count<=20);if(['relative-pronoun','indirect-question','appositive-that','subjunctive'].includes(g.id))assert.equal(count,20,`${g.id}/${d.id}`);}
});
test('upgrade appends once and preserves edited, hidden, deleted questions and all learning data',async()=>{
 const qs=await loadBundledQuestions(QUESTIONS,{fetcher}),store=storage();
 let old=Core.createState(QUESTIONS);
 old=Core.submitAnswer(old,{id:'old-answer',questionId:QUESTIONS[0].id,input:'An existing answer.'},Date.parse('2026-11-10T00:00:00Z'));
 old=Core.saveDraft(old,QUESTIONS[1].id,'Keep this draft');
 old=Core.updateSettings(old,{grammar:'relative-pronoun',theme:'dark',limit:10});
 old=Core.setTextbookProgress(old,'構文80',[1,7]);
 old=Core.addQuestion(old,{...qs[66],japanese:'利用者が編集した設問',explanation:'利用者の解説'});
 old=Core.hideQuestion(old,qs[66].id);
 old=Core.addQuestion(old,qs[67]);old=Core.deleteQuestion(old,qs[67].id);
 store.setItem(Core.STATE_KEY,Core.exportBackup(old));
 const after=(await initializeBundledBank(store,QUESTIONS,{fetcher})).state;
 for(const k of ['answers','drafts','settings','textbookProgress','session'])assert.deepEqual(after[k],old[k],k);
 for(const q of old.questions)assert.deepEqual(after.questions.find(x=>x.id===q.id),q,q.id);
 const serialized=store.getItem(Core.STATE_KEY);
 const again=await initializeBundledBank(store,QUESTIONS,{fetcher});
 assert.equal(again.added,0);assert.equal(store.getItem(Core.STATE_KEY),serialized);
 assert.equal(Core.getReviewSchedule(after,QUESTIONS[0].id).lastResult,null);
 assert.equal(Core.validateState(after).questions.length,after.questions.length);
});
test('existing imported IDs and local similar prompts are not duplicated or overwritten',async()=>{
 const qs=await loadBundledQuestions(QUESTIONS,{fetcher});
 const imported=qs[66],samePrompt={...qs[67],id:'local-question-id'};
 const old=Core.createState([...QUESTIONS,{...imported,source:'user'},samePrompt]);
 const after=reconcileBundledQuestions(old,qs);
 assert.equal(after.questions.filter(q=>q.id===imported.id).length,1);
 assert.equal(after.questions.some(q=>q.id===qs[67].id),false);
 assert.equal(after.questions.find(q=>q.id===imported.id).source,'user');
});
test('a full local cell is preserved and never overfilled',async()=>{
 const qs=await loadBundledQuestions(QUESTIONS,{fetcher}),g='relative-pronoun',d='basic';
 const old=Core.createState(Array.from({length:20},(_,i)=>({...QUESTIONS[0],id:`local-${i}`,grammar_tags:[g],difficulty:d,japanese:`利用者の問題${i}`})));
 const after=reconcileBundledQuestions(old,qs);
 assert.equal(bankCount(after,g,d),20);
 for(const q of old.questions)assert.deepEqual(after.questions.find(x=>x.id===q.id),q);
});
test('failed assets leave saved state usable; malformed storage is not replaced',async()=>{
 const store=storage();const before=Core.initializeState(store,QUESTIONS),raw=store.getItem(Core.STATE_KEY);
 const result=await initializeBundledBank(store,QUESTIONS,{fetcher:async()=>({ok:false,status:503})});
 assert.ok(result.error);assert.deepEqual(result.state,Core.validateState(before));assert.equal(store.getItem(Core.STATE_KEY),raw);
 store.setItem(Core.STATE_KEY,'broken');
 await assert.rejects(()=>initializeBundledBank(store,QUESTIONS,{fetcher}));
 assert.equal(store.getItem(Core.STATE_KEY),'broken');
});
test('indexed duplicate semantics match the original predicate, including containment and punctuation',()=>{
 const prompts=['','a','a b','これは充分に長い既存設問の文です。','これは充分に長い既存設問の文です。追加','ＡＢＣ！','別の文脈の問題を考える。'];
 const index=createPromptIndex(prompts);
 for(const p of [...prompts,'abc','a　b','これは充分に長い既存設問の文です','全く無関係な設定。'])assert.equal(index.has(p),prompts.some(q=>isSimilarPrompt(p,q)),p);
});
test('2480 synthetic rows load and filter within a practical budget',()=>{
 // Structural performance fixture only; these are never shipped as practice questions.
 const start=performance.now();
 const qs=Array.from({length:2480},(_,i)=>({...QUESTIONS[0],id:`perf-${i}`,japanese:`performance-fixture-${i}`,grammar_tags:[GRAMMAR[Math.floor(i/80)].id],difficulty:DIFFICULTIES[Math.floor(i/20)%4].id}));
 const state=Core.createState(qs);
 for(const g of GRAMMAR)for(const d of DIFFICULTIES)assert.equal(bankCount(state,g.id,d.id),20);
 const store=storage();Core.saveState(store,state);const roundTrip=Core.initializeState(store);
 assert.equal(roundTrip.questions.length,2480);
 const duration=performance.now()-start;
 console.log(`2480-row create/count/save/reload: ${duration.toFixed(0)}ms`);
 assert.ok(duration<4000,`operation took ${duration}ms`);
});
