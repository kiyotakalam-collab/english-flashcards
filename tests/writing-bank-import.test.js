import {test} from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS } from '../writing-data.js';
import * as Core from '../writing-core.js';
import {BANK_IMPORT_FORMAT,previewBankImport,applyBankImport,parseBankImport,BANK_IMPORT_MAX} from '../writing-bank-import.js';

const state=()=>Core.createState(QUESTIONS);
const item=(n,patch={})=>({
 id:'bank-relative-pronoun-basic-'+String(n).padStart(3,'0'),
 grammar:'relative-pronoun',difficulty:'basic',
 japanese:`この町で${n}年間働いている人は、別の仕事を探している。`,
 reference_answers:[`A person who has worked in this town for ${n} years is looking for another job.`],
 explanation:'関係代名詞whoの節はpersonを修飾する。',
 ...patch
});
const file=questions=>JSON.stringify({format:BANK_IMPORT_FORMAT,questions});

test('dedicated import accepts only exact bank file format and bounds',()=>{
 assert.throws(()=>parseBankImport(JSON.stringify({questions:[item(1)]})));
 assert.throws(()=>parseBankImport(file([])));
 assert.throws(()=>parseBankImport(file(Array.from({length:BANK_IMPORT_MAX+1},(_,i)=>item(i+1)))));
 assert.deepEqual(parseBankImport(file([item(1)])),[item(1)]);
});
test('preview skips duplicates but rejects bad tags and 20-question overflow atomically',()=>{
 const s=state();
 const dup={...item(1),japanese:QUESTIONS[0].japanese};
 const p=previewBankImport(s,file([item(1),item(2),dup,item(3,{grammar:'nonexistent'})]));
 assert.equal(p.additions.length,2);
 assert.equal(p.duplicates.length,1);
 assert.equal(p.errors.length,1);
 assert.equal(p.ready,false);
 assert.throws(()=>applyBankImport(s,file([item(1),item(2),item(3,{grammar:'nonexistent'})])));
 assert.equal(s.questions.length,66);
 const overcrowded=Array.from({length:21},(_,i)=>item(i+1,{japanese:`第${i+1}回の記念会議では、参加者が異なる議題を選びました。`}));
 const p2=previewBankImport(s,file(overcrowded));
 assert.ok(p2.errors.some(e=>e.reason.includes('20問')));
});
test('import adds only questions and preserves answers, settings and textbook progress',()=>{
 let s=state();
 s=Core.submitAnswer(s,{id:'existing-answer',questionId:QUESTIONS[0].id,input:'My sister gave me an old map.'},Date.parse('2026-11-11T00:00:00Z'));
 const before=structuredClone(s);
 const result=applyBankImport(s,file([item(1),item(2)]));
 assert.equal(result.added,2);
 assert.deepEqual(result.state.answers,before.answers);
 assert.deepEqual(result.state.textbookProgress,before.textbookProgress);
 assert.deepEqual(result.state.settings,before.settings);
 assert.deepEqual(result.state.session,before.session);
 assert.equal(result.state.questions.length,before.questions.length+2);
 const reimport=previewBankImport(result.state,file([item(1),item(2)]));
 assert.equal(reimport.additions.length,0);
 assert.equal(reimport.duplicates.length,2);
});
