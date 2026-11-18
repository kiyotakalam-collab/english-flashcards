import fs from 'node:fs';
import { QUESTIONS, GRAMMAR, DIFFICULTIES } from '../writing-data.js';
import { loadBundledQuestions } from '../writing-bank-loader.js';
import { createState } from '../writing-core.js';
import { bankCount, createPromptIndex } from '../writing-bank.js';
import { WRITING_BANK_RELEASE } from '../writing-bank-manifest.js';
const fetcher = async url => ({ok:true,text:async()=>fs.readFileSync(url,'utf8')});
const questions = await loadBundledQuestions(QUESTIONS,{fetcher});
const state=createState(questions), index=createPromptIndex(), duplicates=[];
for(const q of questions){if(index.has(q.japanese))duplicates.push(q.id);index.add(q.japanese);}
const newRows=JSON.parse(fs.readFileSync('writing-bank-data/completion-284.json','utf8')).questions;
const cells=GRAMMAR.flatMap(g=>DIFFICULTIES.map(d=>({grammar:g.id,label:g.label,difficulty:d.id,github_before:QUESTIONS.filter(q=>q.mode==='short'&&q.grammar_tags.includes(g.id)&&q.difficulty===d.id).length,known_before:bankCount(state,g.id,d.id)-newRows.filter(q=>q.grammar===g.id&&q.difficulty===d.id).length,generated:newRows.filter(q=>q.grammar===g.id&&q.difficulty===d.id).length,registered:bankCount(state,g.id,d.id),device_registered:null,missing:Math.max(0,20-bankCount(state,g.id,d.id))})));
const report={release:WRITING_BANK_RELEASE.id,registered:questions.filter(q=>q.mode==='short').length,target:2480,missing:cells.reduce((n,c)=>n+c.missing,0),duplicates,cells};
fs.writeFileSync('docs/writing-bank/inventory.json',JSON.stringify(report,null,2)+'\n');
fs.writeFileSync('docs/writing-bank/inventory.csv','\ufeffgrammar,label,difficulty,github_before,known_before,generated,registered,missing\n'+cells.map(c=>[c.grammar,c.label,c.difficulty,c.github_before,c.known_before,c.generated,c.registered,c.missing].join(',')).join('\n')+'\n');
console.log(JSON.stringify({...report,cells:undefined}));
if(duplicates.length)process.exitCode=1;
