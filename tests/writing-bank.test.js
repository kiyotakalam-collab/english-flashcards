import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANK_TARGET, BANK_BATCH, bankCount, bankProgress, isSimilarPrompt, isDuplicateQuestion } from '../writing-bank.js';
import { QUESTIONS, GRAMMAR, DIFFICULTIES } from '../writing-data.js';
import * as Core from '../writing-core.js';

test('inventory targets exactly 20 questions for each grammar and difficulty',()=>{
 const state=Core.createState(QUESTIONS);
 assert.equal(BANK_TARGET,20);
 assert.equal(BANK_BATCH,5);
 assert.equal(GRAMMAR.length,31);
 assert.equal(DIFFICULTIES.length,4);
 for(const grammar of GRAMMAR)for(const level of DIFFICULTIES){
   const count=bankCount(state,grammar.id,level.id);
   assert.equal(bankProgress(state,grammar.id,level.id).missing,Math.max(0,20-count));
 }
});

test('duplicate screening catches identical and close paraphrases but accepts different contexts',()=>{
 assert.ok(isSimilarPrompt('昨日会った先生は親切だった。','昨日 会った先生は親切だった！'));
 assert.ok(isSimilarPrompt('彼が昨日買った本は、とても面白かった。','彼が昨日買った本はとても面白かった。'));
 assert.equal(isSimilarPrompt('私は毎朝早く起きる。','彼女は昨日その場所へ行った。'),false);
 const state=Core.createState(QUESTIONS);
 assert.ok(isDuplicateQuestion(state,QUESTIONS[0].japanese));
});

test('generated questions enlarge only the targeted bank without changing answer records',()=>{
 const state=Core.createState(QUESTIONS),tag='relative-pronoun',difficulty='basic',count=bankCount(state,tag,difficulty);
 const at='2026-11-11T00:00:00.000Z';
 const q={id:'writing-ai-bank-regression',mode:'short',difficulty,source:'user',active:true,
   japanese:'三年間この町に住んでいる友人は、今週新しい仕事を始める。',
   reference_answers:['My friend who has lived in this town for three years will start a new job this week.'],
   grammar_tags:[tag],source_detail:'AI生成問題（自動生成・未検証）',
   explanation:'who以下がfriendを修飾する。',created_at:at,updated_at:at};
 const after=Core.addQuestion(state,q);
 assert.equal(bankCount(after,tag,difficulty),count+1);
 assert.deepEqual(after.answers,state.answers);
 assert.equal(bankCount(after,'relative-adverb',difficulty),bankCount(state,'relative-adverb',difficulty));
});
