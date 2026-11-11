import { GRAMMAR, DIFFICULTIES } from './writing-data.js';
import { validateQuestion, validateState } from './writing-core.js';
import { BANK_TARGET, bankCount, isSimilarPrompt } from './writing-bank.js';

export const BANK_IMPORT_FORMAT = 'writing-question-bank-v1';
export const BANK_IMPORT_MAX = GRAMMAR.length * DIFFICULTIES.length * BANK_TARGET;
export const BANK_IMPORT_MAX_BYTES = 3 * 1024 * 1024;
const grammarIds = new Set(GRAMMAR.map(g => g.id));
const difficultyIds = new Set(DIFFICULTIES.map(d => d.id));
const allowed = new Set(['id','grammar','difficulty','japanese','reference_answers','explanation']);

function requireText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${label}が未入力または長すぎます。`);
  return value.trim();
}
export function parseBankImport(json) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > BANK_IMPORT_MAX_BYTES) throw Error('JSONは3MB以下にしてください。');
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw Error('正しいJSONファイルではありません。'); }
  if (!parsed || Array.isArray(parsed) || parsed.format !== BANK_IMPORT_FORMAT ||
      !Array.isArray(parsed.questions) || parsed.questions.length === 0 ||
      parsed.questions.length > BANK_IMPORT_MAX || Object.keys(parsed).some(k => !['format','questions'].includes(k))) {
    throw Error('問題バンク専用形式ではありません。formatとquestionsを確認してください。');
  }
  return parsed.questions;
}
function convert(row, now) {
  if (!row || Array.isArray(row) || typeof row !== 'object' ||
      Object.keys(row).some(k => !allowed.has(k))) throw Error('未対応の項目が含まれています。');
  const id=requireText(row.id, 150, 'ID');
  if (!/^bank-[a-z0-9-]+$/.test(id)) throw Error('IDはbank-で始まる英小文字・数字・ハイフンにしてください。');
  const grammar=requireText(row.grammar, 80, '文法');
  const difficulty=requireText(row.difficulty, 30, '難易度');
  if (!grammarIds.has(grammar) || !difficultyIds.has(difficulty)) throw Error('未対応の文法・難易度です。');
  const japanese=requireText(row.japanese, 600, '日本語の問題文');
  if (!Array.isArray(row.reference_answers) || row.reference_answers.length < 1 ||
      row.reference_answers.length > 3) throw Error('参考英文は1〜3個必要です。');
  const reference_answers=row.reference_answers.map(x=>requireText(x,2000,'参考英文'));
  const explanation=requireText(row.explanation, 1500,'解説');
  return validateQuestion({
    id,mode:'short',difficulty,grammar_tags:[grammar],
    japanese,reference_answers,explanation,active:true,
    source:'user',source_detail:'AI生成問題（外部一括インポート・未検証）',
    created_at:now,updated_at:now
  });
}
// Pure preview. If any row is invalid, commit is disabled rather than silently
// admitting a partly reviewed bank. Exact/near duplicates are safely skipped.
export function previewBankImport(state, raw, now='2026-11-11T00:00:00.000Z') {
  const rows=parseBankImport(raw);
  const errors=[], duplicates=[], additions=[];
  const ids=new Set(state.questions.map(q=>q.id));
  const prompts=state.questions.map(q=>q.japanese);
  const counts=new Map();
  for (const g of GRAMMAR) for(const d of DIFFICULTIES)
    counts.set(`${g.id}:${d.id}`,bankCount(state,g.id,d.id));
  for (let i=0;i<rows.length;i++) {
    let q;
    try { q=convert(rows[i],now); }
    catch(e) { errors.push({row:i+1,reason:e.message});continue; }
    const k=`${q.grammar_tags[0]}:${q.difficulty}`;
    if(ids.has(q.id)) {duplicates.push({row:i+1,reason:'IDが既に存在'});continue;}
    if(prompts.some(p=>isSimilarPrompt(p,q.japanese))) {
      duplicates.push({row:i+1,reason:'同一または類似する問題文'});continue;
    }
    if(counts.get(k)>=BANK_TARGET) {
      errors.push({row:i+1,reason:`${k}は20問の上限に達しています。`});continue;
    }
    ids.add(q.id);prompts.push(q.japanese);counts.set(k,counts.get(k)+1);additions.push(q);
  }
  const cells=[...counts].map(([key,count])=>({key,count,missing:Math.max(0,BANK_TARGET-count)}));
  return {submitted:rows.length,additions,duplicates,errors,cells,
    totalAfter:state.questions.length+additions.length,
    ready:errors.length===0 && additions.length>0};
}
export function applyBankImport(state,raw,now=new Date().toISOString()) {
  const preview=previewBankImport(state,raw,now);
  if(preview.errors.length)throw Error(`不正な問題が${preview.errors.length}件あります。修正して再取り込みしてください。`);
  if(!preview.additions.length)throw Error('追加可能な新規問題がありません。');
  // No imported answers, settings, drafts, progress, or session state can overwrite the user's data.
  const updated=validateState({...state,questions:[...state.questions,...preview.additions]});
  return {state:updated,added:preview.additions.length,duplicates:preview.duplicates.length};
}
