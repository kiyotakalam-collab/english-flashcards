// A local, reviewable inventory. Never changes answers or study progress.
export const BANK_TARGET=20;
export const BANK_BATCH=5;
export function bankQuestions(state, grammarTag, difficulty) {
  return state.questions.filter(q=>q.mode==='short'&&q.difficulty===difficulty&&
    q.grammar_tags.includes(grammarTag)&&q.active!==false&&!q.hidden&&!q.deleted&&
    q.source!=='textbook_progress');
}
export const bankCount=(state,tag,difficulty)=>bankQuestions(state,tag,difficulty).length;
export function normalizePrompt(text) {
  return String(text||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
}
function bigrams(s) {
  const a=new Set();for(let i=0;i<s.length-1;i++)a.add(s.slice(i,i+2));return a;
}
export function isSimilarPrompt(a,b) {
  const x=normalizePrompt(a),y=normalizePrompt(b);
  if(!x||!y)return false;
  if(x===y)return true;
  if(Math.min(x.length,y.length)>12&&(x.includes(y)||y.includes(x)))return true;
  const left=bigrams(x),right=bigrams(y);
  const common=[...left].filter(v=>right.has(v)).length;
  return left.size&&right.size&&2*common/(left.size+right.size)>=0.82;
}
export function isDuplicateQuestion(state, japanese) {
  return state.questions.some(q=>isSimilarPrompt(q.japanese,japanese));
}
export function bankProgress(state,tag,difficulty) {
  const n=bankCount(state,tag,difficulty);
  return {count:n,target:BANK_TARGET,missing:Math.max(0,BANK_TARGET-n)};
}

/** Same semantics as isSimilarPrompt, with one-time normalization per entry. */
export function createPromptIndex(prompts = []) {
  const exact = new Set(), records = [], inverted = new Map();
  function add(prompt) {
    const normal = normalizePrompt(prompt);
    if (!normal || exact.has(normal)) return;
    const grams = bigrams(normal), id = records.length;
    exact.add(normal); records.push({ normal, grams });
    for (const gram of grams) {
      if (!inverted.has(gram)) inverted.set(gram, new Set());
      inverted.get(gram).add(id);
    }
  }
  function has(prompt) {
    const normal = normalizePrompt(prompt);
    if (!normal) return false;
    if (exact.has(normal)) return true;
    const grams = bigrams(normal), shared = new Map();
    for (const gram of grams) for (const id of inverted.get(gram) || []) {
      shared.set(id, (shared.get(id) || 0) + 1);
    }
    for (const [id, common] of shared) {
      const other = records[id];
      if (2 * common / (grams.size + other.grams.size) >= 0.82) return true;
      if (Math.min(normal.length, other.normal.length) > 12 &&
          (normal.includes(other.normal) || other.normal.includes(normal))) return true;
    }
    return false;
  }
  prompts.forEach(add);
  return { add, has };
}
