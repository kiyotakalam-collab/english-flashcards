import * as Core from './writing-core.js';
import { AI_CONFIG_KEY, AI_SESSION_KEY, normalizeEndpoint, fetchAIGrade } from './writing-ai.js';
import { GRAMMAR, ERROR_CATEGORIES, DIFFICULTIES, QUESTIONS, EXAM_DATE, generateVariant } from './writing-data.js';
const $ = (s, root = document) => root.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const aiRequests = new Map();
function aiConnection() {
 try {
  const endpoint=localStorage.getItem(AI_CONFIG_KEY)||'', session=JSON.parse(sessionStorage.getItem(AI_SESSION_KEY)||'null');
  return {endpoint, access:session?.endpoint===endpoint?session.access:''};
 } catch { return {endpoint:'',access:''}; }
}
const aiReady = () => {const c=aiConnection();return !!(c.endpoint&&c.access);};
const labels = {correct:'正解',partial:'部分正解',incorrect:'不正解',pending:'判定保留'};
const strategies = {adaptive:'おすすめ（適応型）',grammar:'文法別',weak:'弱点優先',new:'未出題',review:'復習期限',random:'ランダム'};
let state, currentPage = location.hash.slice(1) || 'dashboard', reviewTab = 'due', saving = false, timer;
let loadError = '';
try { state = Core.initializeState(localStorage, QUESTIONS); } catch(e) { loadError = e.message; }
const app = $('#app');
const toast = message => { $('#toast').textContent=message; $('#toast').style.display='block'; clearTimeout(toast.timeout); toast.timeout=setTimeout(()=>$('#toast').style.display='none',4200); };
async function mutate(fn) { state = await Core.transact(localStorage, fn, {questions:QUESTIONS}); return state; }
const questionText = q => q.japanese || q.prompt || q.text || q.title || '';
const available = () => state.questions.filter(q=>!q.deleted&&!q.hidden&&q.active!==false&&q.source!=='textbook_progress');
const stats = () => Core.getGrammarStats(state, GRAMMAR);
const schedule = q => Core.getReviewSchedule(state,q.id);
const due = q => schedule(q).dueAt && schedule(q).dueAt <= new Date().toISOString();
const graded = () => state.answers.filter(a=>a.evaluation.status!=='pending');
const pct = v => v===null || v===undefined ? '—' : `${Math.round(v*100)}%`;
const options = (rows,selected) => rows.map(r=>`<option value="${esc(r.id)}" ${r.id===selected?'selected':''}>${esc(r.label)}</option>`).join('');
const heading = (tag,title,sub,extra='') => `<div class="page-heading"><div><span class="eyebrow">${tag}</span><h1>${title}</h1><p class="subtext">${sub}</p></div>${extra}</div>`;
const empty = message => `<div class="empty">${message}</div>`;
const action = (name,label,attrs='',cls='') => `<button data-action="${name}" ${attrs} class="${cls}">${label}</button>`;
function modal(html) { $('#modal-body').innerHTML=html; if(!$('#modal').open) $('#modal').showModal(); }
$('#modal-close').onclick=()=>$('#modal').close();
function navigate(page) { location.hash=page; if(currentPage===page) render(); }
function feedbackData(e) {
 let result={...e};try{const v=JSON.parse(e.feedback);if(v&&typeof v==='object')result={...v,...e};}catch{result.reason||=e.feedback;}
 for(const key of ['grammarErrors','correctParts','meaning','naturalness']){
  if(result[key]&&typeof result[key]==='object')result[key]=JSON.stringify(result[key],null,2);
 }
 return result;
}
function feedbackHTML(a) { const e=a.evaluation,f=feedbackData(e); return `<section class="feedback"><div class="actions"><h2>フィードバック</h2><span class="pill">${labels[e.status]}</span><strong>${e.score??'—'} / ${e.maxScore}</strong></div><p class="muted">${f.provenance==='ai'?`OpenAIによる自動添削 · ${esc(f.model||'')}`:f.provenance==='external'?'ユーザー提供の外部採点 · 未検証':'手動採点 · AIによる判定ではありません'}</p><dl>${[['correctParts','よかった点'],['grammarErrors','文法の誤り'],['meaning','意味の保持'],['naturalness','自然さ'],['improved','改善例'],['reason','判定理由'],['confidence','評価の確信度']].map(([key,label])=>`<dt>${label}</dt><dd>${esc(Array.isArray(f[key])?f[key].join('\n'):f[key]??'未記入')}</dd>`).join('')}<dt>エラー分類</dt><dd>${e.errorCategories.map(id=>esc(ERROR_CATEGORIES.find(c=>c.id===id)?.label||id)).join(' / ')||'なし'}</dd></dl>${e.rubric?`<div class="rubric">${Object.entries(e.rubric).map(([k,v])=>`<span class="pill">${esc(({content:'内容',organization:'構成',grammar:'文法',vocabulary:'語彙'})[k]||k)} ${v}/5</span>`).join('')}</div>`:''}<p class="muted">提出 ${esc(new Date(a.submittedAt).toLocaleString('ja-JP'))} · 同じ問題の提出 ${a.submissionCount} 回目 · 採点履歴 ${a.audit.length} 件</p>${action('grade','採点を修正',`data-id="${a.id}"`)} ${action('history','回答と履歴',`data-id="${a.id}"`)} ${a.questionSnapshot.mode==='essay'?action('revise','主張を保って書き直す',`data-id="${a.id}"`):''}</section>`; }
function dashboard() {
 const all=graded(), correct=all.filter(a=>a.evaluation.status==='correct').length, days=new Set(all.map(a=>a.submittedAt.slice(0,10))).size;
 const remain=Math.max(0,Math.ceil((Date.parse(`${EXAM_DATE}T00:00:00+09:00`)-Date.now())/86400000));
 const weak=stats().filter(s=>s.attempts).sort((a,b)=>a.mastery-b.mastery).slice(0,5);
 return heading('MY LEARNING NOTEBOOK','書くたびに、英語が自分のものに。','今日もひとつ、伝えたいことを英語にしてみましょう。',`<span class="date-chip">目標日まで ${remain} 日</span>`)+`<section class="hero"><span class="eyebrow">A LITTLE PRACTICE, EVERY DAY</span><h2>今日の一文から、はじめよう。</h2><p>文法を確かめ、表現を磨く。あなたのペースで積み重ねましょう。</p>${action('quick-start','短文英作文をはじめる ↗','','primary')}<span class="hero-art">Aa✎</span></section><div class="stats"><div class="stat"><span class="label">これまでの回答</span><div class="number">${state.answers.length}<small>文</small></div><span class="muted">採点済み ${all.length} 件</span></div><div class="stat"><span class="label">正解率</span><div class="number">${pct(all.length?correct/all.length:null)}</div><span class="muted">保存した採点結果に基づく</span></div><div class="stat"><span class="label">期限が来た復習</span><div class="number">${available().filter(due).length}<small>問</small></div><span class="muted">今日の振り返り</span></div><div class="stat"><span class="label">学習した日</span><div class="number">${days}<small>日</small></div><span class="muted">採点済みの学習記録</span></div></div><div class="grid-two"><section class="card"><h2>今日の学習メニュー</h2>${[['short','↗','短文英作文','日本語の意味を、自然な英文へ。'],['grammar','▤','文法トレーニング',`${GRAMMAR.length}カテゴリを、ひとつずつ。`],['essay','✎','自由英作文','主張・理由・具体例をつなげる。']].map(([page,icon,title,sub])=>`<a class="row" href="#${page}"><span class="row-icon">${icon}</span><div class="row-body"><strong>${title}</strong><p>${sub}</p></div><span>↗</span></a>`).join('')}</section><section class="card"><h2>次に伸ばしたいところ</h2>${weak.length?weak.map(s=>`<div class="row"><div class="row-body"><strong>${esc(s.label)}</strong><p>加重得点率 ${pct(s.weightedScore)} · 信頼度 ${pct(s.confidence)}</p><div class="progress"><span style="width:${Math.round(s.mastery*100)}%"></span></div></div>${action('category','練習',`data-id="${s.id}"`)}</div>`).join(''):empty('まだ分析データがありません。<br>採点を記録すると、ここに表示されます。')}<a href="#analytics" class="muted">弱点分析を開く →</a></section></div>${state.session.currentQuestionId?`<section class="card" style="margin-top:20px"><h3>続きから取り組めます</h3><p class="muted">入力中の英文とセッションを保存しています。</p>${action('resume','保存した学習を再開')}</section>`:''}<p class="muted">目標日は学習計画用です。収録問題と20点評価はアプリ独自のもので、公式試験の採点基準ではありません。</p>`;
}
function settingsHTML(mode) { const s=state.settings; return `<form id="session-form" class="settings" data-mode="${mode}"><label>問題数<select name="limit">${[5,10,20,0].map(n=>`<option value="${n}" ${Number(s.limit??5)===n?'selected':''}>${n||'無制限'}</option>`).join('')}</select></label><label>出題方針<select name="strategy">${options(Object.entries(strategies).map(([id,label])=>({id,label})),s.strategy??'adaptive')}</select></label><label>難易度<select name="difficulty">${options(DIFFICULTIES,s.difficulty)}</select></label><label>文法<select name="grammar"><option value="">すべて</option>${options(GRAMMAR,s.grammar)}</select></label>${mode==='essay'?`<label>制限時間（任意）<select name="minutes">${[0,10,20,30,40].map(n=>`<option value="${n}" ${Number(s.minutes??0)===n?'selected':''}>${n?`${n}分`:'なし'}</option>`).join('')}</select></label>`:''}<button class="primary" type="submit">新しい練習を開始</button></form>`; }
function practice(mode) { const session=state.session,q=state.questions.find(q=>q.id===session.currentQuestionId && q.mode===mode && !q.deleted && !q.hidden && q.source!=='textbook_progress');
 const a=session.currentAnswerId?state.answers.find(a=>a.id===session.currentAnswerId):null;
 const parent=session.parentAnswerId?state.answers.find(a=>a.id===session.parentAnswerId):null;
 const draft=q?(state.drafts[q.id]??''):'';
 return heading(mode==='essay'?'ESSAY STUDIO':'SHORT WRITING',mode==='essay'?'考えを、ひとつの英文に。':'短文英作文','正解はひとつとは限りません。意味を保ちながら、自分の言葉で。')+(q?'':settingsHTML(mode))+(q?`<section class="card writing-card"><div class="actions"><span class="pill">${mode==='essay'?'自由英作文':'日本語 → 英語'}</span><span class="pill warm">${esc(DIFFICULTIES.find(d=>d.id===q.difficulty)?.label)}</span><span class="muted">${q.grammar_tags.map(t=>esc(GRAMMAR.find(g=>g.id===t)?.label||t)).join(' / ')} · ${session.position??1}${session.limit?` / ${session.limit}`:''}</span></div><p class="prompt">${esc(questionText(q))}</p>${parent?`<div class="notice">書き直し ${revisionDepth(parent)+1} 回目。元の主張を保持し、表現や論理のつながりを改善しましょう。<details><summary>前の回答を比較用に表示</summary><p class="history-answer">${esc(parent.input)}</p></details></div>`:''}${mode==='essay'?`<p class="muted">目安 ${q.word_min??q.min_words??80}〜${q.word_max??q.max_words??120}語（練習用・未達でも提出できます）</p><div class="rubric">${['内容','構成','文法','語彙'].map(l=>`<span class="pill">${l} 0–5点</span>`).join('')}<span class="muted">計20点・独自の練習基準</span></div>`:''}<label for="answer-input" class="muted">YOUR ANSWER</label><textarea id="answer-input" class="answer-area" lang="en" spellcheck="true" placeholder="Write your answer here…" ${a?'readonly':''}>${esc(a?a.input:draft)}</textarea><div class="editor-meta"><span id="word-count">${wordCount(a?a.input:draft)} words</span><span id="save-state" class="saved">${a?'回答を保存済み':'入力内容を自動保存'}</span><span id="timer-display"></span></div><div class="actions">${a?`${action('grade',a.evaluation.status==='pending'?'採点する':'採点を修正',`data-id="${a.id}"`,'primary')}${action('next','次の問題 →')}`:`${action('submit','採点する','','primary')}${action('defer','あとで取り組む')}`}${action('end-session','練習を終了')}</div><p class="muted">${aiReady()?'「採点する」で問題文と英文を送信し、AI添削・分類・復習予定を自動保存します。':'AI添削は未接続です。「採点する」で手動評価を開きます。上部の「AI添削の接続」で設定できます。'} Ctrl / ⌘ + Enter でも採点できます。</p>${a?feedbackHTML(a):''}<details style="margin-top:20px"><summary>参考表現・学習メモ（唯一の正解ではありません）</summary>${q.reference_answers.map(v=>`<p>${esc(v)}</p>`).join('')}<p class="muted">${esc(q.explanation)}</p><p class="muted">${esc(q.source_detail||q.source)}</p></details></section>`:`<section class="card">${empty('出題設定を選んで、練習をはじめましょう。<br>以前の下書きは問題ごとに保存されています。')}${session.currentQuestionId?action('resume','保存した学習を再開'):''}</section>`); }
function wordCount(v) { return (v.match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g)||[]).length; }
function revisionDepth(a) { let n=0;const seen=new Set();while(a?.parentAnswerId&&!seen.has(a.id)){seen.add(a.id);n++;a=state.answers.find(x=>x.id===a.parentAnswerId);}return n; }
function grammarPage() { const gs=stats();return heading('GRAMMAR LIBRARY','文法を、使える知識に。',`${GRAMMAR.length}カテゴリの練習記録と、教材の進捗を分けて管理します。`)+`<section class="card"><div class="section-heading" style="margin-top:0"><h2>教材の学習記録</h2>${action('textbook','手動で記録')}</div><p class="muted">構文80 · 学習済みとして確認した項目だけを記録します。アプリ練習で教材の進捗は増えません。</p><strong>${(state.textbookProgress['構文80']?.confirmedItems??[]).map(n=>`第${n}項`).join('、')||'未記録'}</strong><p class="muted">初期確認：第1項のみ。教材の本文・設問は収録していません。</p></section>`+ [...new Set(GRAMMAR.map(g=>g.group))].map(group=>`<h2 class="group-label">${esc(group)}</h2><div class="grid-three">${GRAMMAR.filter(g=>g.group===group).map(g=>{const s=gs.find(s=>s.id===g.id);return `<section class="card category"><span class="eyebrow">${s.mastered?'MASTERED':s.attempts?'IN PRACTICE':'NOT STARTED'}</span><h3 style="margin-top:10px">${esc(g.label)}</h3><p class="muted">${s.attempts}回答 · 正解率 ${pct(s.accuracy)}</p><div class="progress"><span style="width:${Math.round((s.mastery??0)*100)}%"></span></div><p class="muted">習熟度 ${pct(s.mastery)} · 信頼度 ${pct(s.confidence)}</p>${action('category','この文法を練習 →',`data-id="${g.id}"`)}</section>`;}).join('')}</div>`).join(''); }
function reviewPage() { let rows=available(); if(reviewTab==='due')rows=rows.filter(due);if(reviewTab==='unmastered') rows=rows.filter(q=>state.answers.some(a=>a.questionId===q.id&&a.evaluation.status!=='pending')&&!schedule(q).mastered);if(reviewTab==='pending')rows=rows.filter(q=>state.answers.some(a=>a.questionId===q.id&&a.evaluation.status==='pending'));if(reviewTab==='deferred')rows=rows.filter(q=>state.session.deferredQuestionIds.includes(q.id));return heading('REVIEW CENTER','振り返って、定着させる。','復習期限・未習得・採点待ちは別々の状態です。')+`<div class="tabs">${[['due','期限が来た問題'],['unmastered','未習得'],['pending','採点待ち'],['deferred','あとで取り組む']].map(([id,l])=>action('review-tab',l,`data-id="${id}"`,reviewTab===id?'active':'')).join('')}</div><section class="card">${rows.length?rows.map(q=>{const s=schedule(q),pending=state.answers.filter(a=>a.questionId===q.id&&a.evaluation.status==='pending').at(-1);return `<div class="row"><div class="row-body"><strong>${esc(questionText(q))}</strong><p>${s.lastResult?labels[s.lastResult]:'未採点'} · ${s.mastered?'習得済み':'未習得'} · 次回 ${s.dueAt?new Date(s.dueAt).toLocaleString('ja-JP'):'未設定'}</p></div><div class="actions">${reviewTab==='pending'&&pending?action('grade','採点',`data-id="${pending.id}"`):action('question','取り組む',`data-id="${q.id}"`)}${action('review-defer','あとで',`data-id="${q.id}"`)}</div></div>`;}).join(''):empty('この状態の問題はありません。')}</section><p class="muted">復習は1・3・7・14・30日の段階制。未習得は期限前の問題も含みます。「あとで」は回答・誤答として数えません。</p>`; }
function analyticsPage() { const gs=stats(),all=graded(), categories=ERROR_CATEGORIES.map(c=>({...c,n:all.filter(a=>a.evaluation.errorCategories.includes(c.id)).length}));return heading('LEARNING INSIGHTS','苦手を知る。次の一歩が見える。','採点した回答だけを分析します。記録が少ない領域は、信頼度も低く表示されます。')+`<div class="grid-two"><section class="card"><h2>エラーの傾向 · ${ERROR_CATEGORIES.length}分類</h2>${categories.map(c=>`<div class="bar-row"><span>${esc(c.label)}</span><div class="progress"><span style="width:${all.length?c.n/all.length*100:0}%"></span></div><span>${c.n}件</span></div>`).join('')}</section><section class="card"><h2>直近7日間の記録</h2><div class="spark-chart">${Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);const key=d.toISOString().slice(0,10),n=all.filter(a=>a.submittedAt.slice(0,10)===key).length;return `<div class="spark-column"><div style="height:${Math.min(n*10,75)+2}px" title="${n}回答"></div>${d.getMonth()+1}/${d.getDate()}<p>${n}件</p></div>`;}).join('')}</div><p class="muted">採点待ちは含みません。改善傾向は各カテゴリの前半・後半の得点率差です。</p><h3 style="margin-top:25px">関係詞をもう一問</h3><p class="muted">目的格の関係代名詞と代名詞の重複を練習する、独自テンプレートによる追加問題です。AI生成ではありません。他カテゴリの生成には未対応です。</p>${action('generate','関係代名詞の類題を追加')}</section></div><div class="section-heading"><h2>文法別の習熟と確かさ</h2></div><section class="card">${gs.map(s=>`<div class="row"><div class="row-body"><strong>${esc(s.label)}</strong><p>${s.attempts}回答 · 加重得点率 ${pct(s.weightedScore)} · 信頼度 ${pct(s.confidence)} · 傾向 ${s.trend===null?'データ不足':`${s.trend>=0?'+':''}${Math.round(s.trend*100)}pt`}</p><div class="progress"><span style="width:${Math.round((s.mastery??0)*100)}%"></span></div></div>${action('category','練習',`data-id="${s.id}"`)}</div>`).join('')}</section><p class="muted">難易度と30日半減の新しさで得点を加重し、観測量から信頼度を計算。習熟度は加重得点率×信頼度です。外部採点もユーザー提供の未検証データとして集計します。</p>`; }
function render() { clearInterval(timer); if(loadError){app.innerHTML=heading('STORAGE','保存データを読み込めませんでした。','既存データは上書きしていません。')+`<div class="notice">${esc(loadError)}</div>`;return;} if(!['dashboard','short','grammar','essay','review','analytics'].includes(currentPage))currentPage='dashboard';app.innerHTML=({dashboard,short:()=>practice('short'),grammar:grammarPage,essay:()=>practice('essay'),review:reviewPage,analytics:analyticsPage})[currentPage]();document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.page===currentPage));$('#due-badge').textContent=available().filter(due).length;document.body.classList.toggle('dark',state.settings.theme==='dark');startTimer(); }
function startTimer(){const update=()=>{const el=$('#timer-display');if(!el||!state.session.deadline)return;const sec=Math.max(0,Math.ceil((Date.parse(state.session.deadline)-Date.now())/1000));el.textContent=sec?`残り ${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`:'時間終了（入力・提出は続けられます）';};update();timer=setInterval(update,1000);}
function choose(s) { const settings=s.settings;let rows=Core.getCandidates(s,GRAMMAR,{mode:settings.mode,difficulty:settings.difficulty}).filter(q=>q.source!=='textbook_progress'&&q.active!==false&&!s.session.answeredQuestionIds.includes(q.id));if(settings.grammar)rows=rows.filter(q=>q.grammar_tags.includes(settings.grammar));if(settings.strategy==='new')rows=rows.filter(q=>!s.answers.some(a=>a.questionId===q.id));if(settings.strategy==='review')rows=rows.filter(q=>q.reviewSchedule.dueAt&&q.reviewSchedule.dueAt<=new Date().toISOString());if(settings.strategy==='weak'){const weak=Core.getGrammarStats(s,GRAMMAR).filter(x=>x.attempts).sort((a,b)=>a.mastery-b.mastery);rows.sort((a,b)=>Math.min(...a.grammar_tags.map(t=>weak.findIndex(w=>w.id===t)<0?999:weak.findIndex(w=>w.id===t)))-Math.min(...b.grammar_tags.map(t=>weak.findIndex(w=>w.id===t)<0?999:weak.findIndex(w=>w.id===t))));}if(settings.strategy==='random')rows.sort(()=>Math.random()-.5);return rows[0]; }
async function openQuestion(id,parent=null) { await mutate(s=>{if(!s.session.id)s=Core.startSession(s);s.session.deferredQuestionIds=s.session.deferredQuestionIds.filter(x=>x!==id);return Core.updateSession(s,{currentQuestionId:id,currentAnswerId:null,draftId:uid(),parentAnswerId:parent,position:(s.session.position??0)+1,limit:s.settings.limit??5});});navigate(state.questions.find(q=>q.id===id).mode); }
async function nextQuestion(){await mutate(s=>{if(s.session.limit&&s.session.position>=s.session.limit)return Core.updateSession(s,{currentQuestionId:null,currentAnswerId:null,parentAnswerId:null});const q=choose(s);return Core.updateSession(s,{currentQuestionId:q?.id??null,currentAnswerId:null,draftId:uid(),parentAnswerId:null,position:(s.session.position??0)+1});});if(!state.session.currentQuestionId)toast('このセッションの練習が終了しました。下書きは保存されています。');render();}
let draftQueue=Promise.resolve();
function persistDraft(text){const id=state.session.currentQuestionId;draftQueue=draftQueue.catch(()=>{}).then(()=>mutate(s=>Core.saveDraft(s,id,text)));return draftQueue;}
app.addEventListener('input',e=>{if(e.target.id==='answer-input'){const text=e.target.value;$('#word-count').textContent=`${wordCount(text)} words`;$('#save-state').textContent='保存中…';persistDraft(text).then(()=>{if($('#save-state'))$('#save-state').textContent='下書きを保存しました';}).catch(e=>{if($('#save-state'))$('#save-state').textContent='保存できません。入力をコピーしてください';toast(e.message);});}});
app.addEventListener('keydown',e=>{if(e.target.id==='answer-input'&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();submitForGrade();}});
async function submitForGrade(){if(saving)return;const field=$('#answer-input');if(!field?.value.trim()){toast('英文を入力してください。');return;}saving=true;const button=$('[data-action="submit"]');if(button)button.disabled=true;try{await draftQueue;const id=state.session.draftId||uid(),input=field.value,qid=state.session.currentQuestionId,parent=state.session.parentAnswerId??null;await mutate(s=>{let next=s;if(!s.answers.some(a=>a.id===id))next=Core.submitAnswer(s,{id,questionId:qid,input,parentAnswerId:parent,method:aiReady()?'ai':'manual'});return Core.updateSession(next,{currentAnswerId:id,draftId:id});});render();if(aiReady())await autoGrade(id);else gradeModal(id);}catch(e){toast(`保存できません: ${e.message}`);}finally{saving=false;if(button)button.disabled=false;}}

function aiSettingsModal() {
 const c=aiConnection();
 modal(`<h2>AI自動添削の接続</h2><p class="notice">OpenAI APIキーはここに入力しません。Cloudflare Worker側のSecretに登録します。</p><form id="ai-settings-form"><label>添削API URL<input name="endpoint" type="url" required value="${esc(c.endpoint)}" placeholder="https://kotoba-writing-ai.example.workers.dev/grade"></label><label>AI接続コード<input name="access" type="password" required minlength="32" maxlength="256" autocomplete="off" value="${esc(c.access||'')}" placeholder="WorkerのAPP_ACCESS_TOKENと同じ値"></label><p class="muted">保存後は「採点する」で問題文・参考英文・入力英文を、このAPI経由でOpenAIへ送信します。全学習履歴や単語データは送りません。API利用料が発生します。接続コードはこのタブのセッション内だけに保存し、バックアップには含めません。</p><p role="alert" hidden></p><button class="primary" type="submit">保存してAI採点を有効にする</button></form><p>${action('ai-disconnect','AI接続を解除して手動採点に戻す')}</p><p><a href="https://github.com/kiyotakalam-collab/english-flashcards/blob/main/docs/AI_SETUP.md" target="_blank" rel="noopener">サーバーとAPIキーの設定手順</a></p>`);
}
async function autoGrade(id) {
 if(aiRequests.has(id))return aiRequests.get(id);
 if(!aiReady()){aiSettingsModal();return;}
 const answer=state.answers.find(a=>a.id===id);if(!answer)return;
 const auditBefore=JSON.stringify(answer.audit),connection=aiConnection();
 const operation=(async()=>{
  modal(`<h2>AI採点中</h2><p role="status">答案は端末に保存済みです。文法・意味・自然さを確認しています。</p><p class="muted">この画面を閉じても処理は続きます。通信に失敗した場合は、同じ答案から再試行できます。</p>`);
  try {
   const grade=await fetchAIGrade(connection.endpoint,connection.access,answer);
   let applied=false;
   await mutate(s=>{const current=s.answers.find(a=>a.id===id);if(!current||JSON.stringify(current.audit)!==auditBefore)return s;applied=true;return Core.gradeAnswer(s,id,grade);});
   if(!applied){toast('待機中に評価が変更されたため、AI結果は上書きしませんでした。');return;}
   $('#modal').close();render();toast(grade.status==='pending'?'AIの判定が曖昧なため保留しました。手動で確認できます。':'AI添削・誤答分類・復習予定を保存しました。');
  } catch(error) {
   modal(`<h2>AI採点を完了できませんでした</h2><p class="notice" role="alert">${esc(error.message)}</p><p>答案と現在の評価は保存されています。通信失敗を誤答として数えません。</p><div class="actions">${action('ai-grade','同じ答案でAIを再試行',`data-id="${id}"`,'primary')}${action('grade','手動で採点する',`data-id="${id}"`)}${action('ai-settings','接続設定を確認')}</div>`);
  }
 })();
 aiRequests.set(id,operation);
 try {await operation;}finally{aiRequests.delete(id);}
}

function gradeModal(id) {
  const answer=state.answers.find(a=>a.id===id); if(!answer) return;
  const e=feedbackData(answer.evaluation), essay=answer.questionSnapshot.mode==='essay';
  modal(`<h2>手動フィードバック</h2>${answer.evaluation.status==='pending'?action('ai-grade','この答案をAIで採点',`data-id="${id}"`,'primary'):''}<p class="notice">${aiReady()?'AI採点後も、ここで評価を訂正できます。':'AI添削は未接続です。上部の「AI添削の接続」で設定できます。'}参考英文は唯一の正解ではありません。意味・文法を確認し、判断できなければ判定保留にしてください。</p><p class="prompt">${esc(questionText(answer.questionSnapshot))}</p><blockquote class="history-answer">${esc(answer.input)}</blockquote><form id="grade-form" data-id="${id}" class="form-grid"><label>判定<select name="status">${options(Object.entries(labels).map(([id,label])=>({id,label})),e.status)}</select></label>${essay?`<div class="full rubric">${[['content','設問要求への適合'],['organization','論理構成・一貫性'],['grammar','文法の正確性'],['vocabulary','語彙・表現']].map(([key,label])=>`<label>${label} / 5<input type="number" min="0" max="5" step="1" name="rubric-${key}" value="${e.rubric?.[key]??0}" required></label>`).join('')}<p class="muted">合計20点はアプリ内の診断指標です。慶應文学部の公式基準ではありません。</p></div>`:`<label>得点 / 10<input name="score" type="number" min="0" max="10" step="0.5" value="${e.score??0}"></label>`}<label>確信度 0〜1<input name="confidence" type="number" min="0" max="1" step="0.05" value="${e.confidence??0.5}"></label>${[['correctParts','正しい部分'],['grammarErrors','文法上の問題'],['meaning','意味の過不足'],['naturalness','不自然な語法'],['improved','主張・意味を保った改善英文'],['reason','具体的な採点理由・修正方法']].map(([key,label])=>`<label class="full">${label}<textarea name="${key}" rows="2">${esc(Array.isArray(e[key])?e[key].join('\n'):e[key]??'')}</textarea></label>`).join('')}<fieldset class="full"><legend>誤答分類（複数選択可）</legend>${ERROR_CATEGORIES.map(c=>`<label class="check-row"><input name="error" type="checkbox" value="${c.id}" ${e.errorCategories.includes(c.id)?'checked':''}>${esc(c.label)}</label>`).join('')}</fieldset><p id="grade-error" class="notice full" role="alert" hidden></p><button type="submit" class="primary full">評価を保存</button></form><details><summary>参考英文・解説</summary>${answer.questionSnapshot.reference_answers.map(text=>`<p>${esc(text)}</p>`).join('')}<p>${esc(answer.questionSnapshot.explanation)}</p></details><details><summary>外部の構造化フィードバックを取り込む</summary><p class="muted">JSONをユーザー提供の未検証評価として読み込みます。日本語の設問と答案の両方を外部添削者に渡してください。このJSON取り込み操作では外部送信しません。AI採点ボタンでは設問と英文を送信します。</p><p><button data-action="feedback-prompt" data-id="${id}">添削依頼文を表示</button></p><label>評価JSON<textarea id="external-feedback" rows="5" placeholder='{"status":"correct","score":10,"reason":"意味と文法を比較した根拠","grammarErrors":[],"confidence":0.9}'></textarea></label>${action('external-grade','外部評価を保存',`data-id="${id}"`)}</details>`);
}
function gradeFromForm(form) {
 const f=new FormData(form), status=f.get('status'), essay=!!form.querySelector('[name="rubric-content"]');
 const rubric=essay&&status!=='pending'?Object.fromEntries(['content','organization','grammar','vocabulary'].map(k=>[k,Number(f.get(`rubric-${k}`))])):null;
 const fields=Object.fromEntries(['correctParts','grammarErrors','meaning','naturalness','improved','reason'].map(k=>[k,String(f.get(k)||'')]));
 if(status!=='pending'&&!fields.reason.trim())throw Error('採点の理由を具体的に記入してください。');
 return {status,score:status==='pending'?null:rubric?Object.values(rubric).reduce((a,b)=>a+b,0):Number(f.get('score')),rubric,errorCategories:f.getAll('error'),...fields,confidence:Number(f.get('confidence')),feedback:JSON.stringify({provenance:'manual'})};
}
let grading=false;
async function saveGrade(id,grade) {
 if(grading) return; grading=true;
 try { await mutate(s=>Core.gradeAnswer(s,id,grade)); $('#modal').close(); render(); toast('評価と復習予定を保存しました。'); }
 finally { grading=false; }
}
$('#modal').addEventListener('submit', async event=>{
 event.preventDefault(); const form=event.target, button=form.querySelector('[type="submit"]'); if(button)button.disabled=true;
 try {
  if(form.id==='grade-form') await saveGrade(form.dataset.id,gradeFromForm(form));
  if(form.id==='ai-settings-form') {
   const data=new FormData(form),endpoint=normalizeEndpoint(String(data.get('endpoint')||'').trim()),access=String(data.get('access')||'').trim();
   if(access.length<32||access.length>256||/[\r\n]/.test(access)||access.startsWith('sk-'))throw Error('OpenAIキーではなく、32文字以上のAI接続コードを入力してください。');
   localStorage.setItem(AI_CONFIG_KEY,endpoint);sessionStorage.setItem(AI_SESSION_KEY,JSON.stringify({endpoint,access}));
   $('#modal').close();render();toast('AI接続設定を保存しました。次の答案から自動添削します。');
  }
  if(form.id==='question-form') { const f=new FormData(form), old=state.questions.find(q=>q.id===form.dataset.id), now=new Date().toISOString();const q={...(old||{}),id:old?.id||`writing-user-${uid()}`,mode:f.get('mode'),japanese:String(f.get('japanese')),reference_answers:String(f.get('references')||'').split('\n').filter(Boolean),grammar_tags:f.getAll('grammar'),difficulty:f.get('difficulty'),source:f.get('source'),source_detail:String(f.get('source_detail')||'ユーザーが登録。出典の確認は登録者が行います。'),explanation:String(f.get('explanation')||'解説は未登録です。'),active:true,created_at:old?.created_at||now,updated_at:now};if(!q.grammar_tags.length)throw Error('文法を1項目以上選択してください。');await mutate(s=>Core.upsertQuestion(s,q));manageModal();toast('問題を保存しました。'); }
  if(form.id==='textbook-form') {const f=new FormData(form),book=String(f.get('book')||'').trim();const values=String(f.get('items')||'').split(/[,、\s]+/).filter(Boolean).map(Number);if(!book)throw Error('教材名を入力してください。');await mutate(s=>Core.setTextbookProgress(s,book,values));$('#modal').close();render();toast('実際に取り組んだ項目だけを記録しました。');}
 } catch(error) {const field=form.querySelector('[role="alert"]');if(field){field.textContent=error.message;field.hidden=false;}toast(error.message);}
 finally{if(button?.isConnected)button.disabled=false;}
});
function download(text,name) {const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function manageModal() {
 modal(`<h2>問題・データ管理</h2><p class="muted">英作文専用のデータです。単語や世界史の履歴を操作しません。</p><div class="actions">${action('new-question','問題を追加','','primary')}${action('export','JSONバックアップを書き出す')}<label>JSONを復元<input id="writing-import" type="file" accept=".json,application/json"></label></div><p class="muted">同じ回答IDは重複登録しません。矛盾する採点訂正はデータ保護のため取り込みを中止します。編集・削除された問題も、過去の答案のスナップショットには残ります。</p><div class="question-list">${state.questions.map(q=>`<div class="row"><div class="row-body"><strong>${esc(questionText(q))}</strong><p>${esc(({original:'アプリ独自',user:'ユーザー登録',textbook_progress:'教材進捗用',past_exam_user:'過去問由来のユーザー登録'})[q.source])} · ${q.deleted?'削除済み':q.hidden||!q.active?'非表示':'出題対象'}</p></div>${!q.deleted?`<div class="actions">${action('edit-question','編集',`data-id="${q.id}"`)}${action('hide-question',q.hidden||!q.active?'再表示':'非表示',`data-id="${q.id}"`)}${action('delete-question','削除',`data-id="${q.id}"`)}</div>`:''}</div>`).join('')}</div><p id="import-error" role="alert"></p>`);
}
function questionModal(id) {
 const q=state.questions.find(q=>q.id===id);
 modal(`<h2>${q?'問題を編集':'問題を追加'}</h2><form id="question-form" data-id="${q?.id||''}" class="form-grid"><label>種類<select name="mode">${options([{id:'short',label:'和文英訳'},{id:'essay',label:'自由英作文'}],q?.mode||'short')}</select></label><label>難易度<select name="difficulty">${options(DIFFICULTIES,q?.difficulty||'standard')}</select></label><label class="full">日本語の問題文<textarea name="japanese" required rows="3">${esc(q?.japanese||'')}</textarea></label><label class="full">参考英文（1行1例・空欄可）<textarea name="references">${esc(q?.reference_answers.join('\n')||'')}</textarea></label><label>出典区分<select name="source">${options([{id:'original',label:'アプリ独自問題'},{id:'user',label:'ユーザー登録問題'},{id:'textbook_progress',label:'教材進捗用データ（出題しない）'},{id:'past_exam_user',label:'過去問由来のユーザー登録問題'}],q?.source||'user')}</select></label><label>出典詳細・教材との対応<input name="source_detail" value="${esc(q?.source_detail||'')}" placeholder="教材名・項番号など。確認できた範囲のみ"></label><fieldset class="full"><legend>対象文法</legend>${GRAMMAR.map(g=>`<label class="check-row"><input type="checkbox" name="grammar" value="${g.id}" ${q?.grammar_tags.includes(g.id)?'checked':''}>${esc(g.label)}</label>`).join('')}</fieldset><label class="full">解説<textarea name="explanation">${esc(q?.explanation||'')}</textarea></label><p class="muted full">教材・過去問の本文は、自分で入力したもの、または利用許諾のあるものだけを登録してください。出典不明なら教材名・年度を付けないでください。</p><button class="primary full" type="submit">問題を保存</button></form>`);
}
function textbookModal(book='構文80') {
 modal(`<h2>教材の実施済み項目を登録</h2><p class="notice">実際に取り組んだ項目だけを入力してください。構文80の全80項の完走を前提にはしません。アプリの類題を解いても、この進捗は増えません。</p><form id="textbook-form"><label>教材名<input name="book" value="${esc(book)}" list="book-names" required><datalist id="book-names">${['構文80','英作文ハイパートレーニング','慶應文学部英語過去問','ユーザー教材'].map(name=>`<option value="${name}">`).join('')}</datalist></label><label>実施済みの項番号（カンマ区切り）<input name="items" value="${(state.textbookProgress[book]?.confirmedItems||[]).join(',')}" placeholder="例：1,3,8"></label><button class="primary" type="submit">実施済み項目を保存</button></form>`);
}
function diffHTML(original,improved) {
 const a=original.split(/\s+/).filter(Boolean).slice(0,500), b=improved.split(/\s+/).filter(Boolean).slice(0,500);
 const matrix=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)matrix[i][j]=a[i]===b[j]?matrix[i+1][j+1]+1:Math.max(matrix[i+1][j],matrix[i][j+1]);
 let i=0,j=0,out=[];while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){out.push(esc(a[i++]));j++;}else if(j<b.length&&(i===a.length||matrix[i][j+1]>=matrix[i+1][j]))out.push(`<ins>${esc(b[j++])}</ins>`);else out.push(`<del>${esc(a[i++])}</del>`);}return out.join(' ');
}
function historyModal(id) {
 const answer=state.answers.find(a=>a.id===id);if(!answer)return;
 const e=feedbackData(answer.evaluation), children=state.answers.filter(a=>a.parentAnswerId===id);
 modal(`<h2>答案と修正の記録</h2><p>${esc(questionText(answer.questionSnapshot))}</p><p class="muted">答案ID ${id} · ${esc(answer.method)} · 書き直し ${revisionDepth(answer)} 回</p><h3>提出した英文</h3><p class="history-answer">${esc(answer.input)}</p>${e.improved?`<h3>改善案との差分</h3><p class="muted">赤い取り消し線：削除、緑：追加（先頭500語まで比較）</p><p class="history-answer">${diffHTML(answer.input,e.improved)}</p>`:''}${children.map(a=>`<h3>書き直した答案</h3><p class="history-answer">${esc(a.input)}</p>${action('history','この答案を見る',`data-id="${a.id}"`)}`).join('')}<h3>採点訂正の監査履歴</h3>${answer.audit.map(a=>`<p class="muted">${esc(a.at)} · ${labels[a.previous.status]} → ${labels[a.evaluation.status]} · ${a.evaluation.score??'—'}点</p>`).join('')||'<p>まだ採点していません。</p>'}${action('grade','この答案の評価を修正',`data-id="${id}"`)}`);
}
async function startPractice(mode,grammar='') {
 await draftQueue;
 await mutate(s=>{const lastAnsweredId=s.answers.at(-1)?.questionId??null;s=Core.startSession(s);s=Core.updateSettings(s,{mode,grammar,strategy:grammar?'grammar':s.settings.strategy||'adaptive'});let q=choose(s);if(q?.id===lastAnsweredId){const candidates=Core.getCandidates(s,GRAMMAR,{mode:s.settings.mode,difficulty:s.settings.difficulty}).filter(item=>item.source!=='textbook_progress'&&item.id!==lastAnsweredId&&(!s.settings.grammar||item.grammar_tags.includes(s.settings.grammar))&&!s.session.deferredQuestionIds.includes(item.id));if(candidates.length&&s.settings.strategy!=='review'&&s.settings.strategy!=='new')q=candidates[0];}if(q){s=Core.saveDraft(s,q.id,'');}return Core.updateSession(s,{currentQuestionId:q?.id??null,currentAnswerId:null,draftId:uid(),parentAnswerId:null,position:q?1:0,limit:s.settings.limit??5,deadline:mode==='essay'&&s.settings.minutes?new Date(Date.now()+Number(s.settings.minutes)*60000).toISOString():null});});
 navigate(mode);render();
}
app.addEventListener('submit',async event=>{if(event.target.id!=='session-form')return;event.preventDefault();const f=new FormData(event.target);try{await mutate(s=>Core.updateSettings(s,{mode:event.target.dataset.mode,limit:Number(f.get('limit')),strategy:f.get('strategy'),difficulty:f.get('difficulty'),grammar:f.get('grammar'),minutes:Number(f.get('minutes')||0)}));await startPractice(event.target.dataset.mode,String(f.get('grammar')||''));}catch(error){toast(error.message);}});
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-action]');if(!button)return;
 const name=button.dataset.action,id=button.dataset.id;
 try {
  if(name==='submit')return await submitForGrade();
  if(name==='ai-settings')return aiSettingsModal();
  if(name==='ai-grade')return await autoGrade(id);
  if(name==='ai-disconnect'){sessionStorage.removeItem(AI_SESSION_KEY);localStorage.removeItem(AI_CONFIG_KEY);$('#modal').close();render();toast('AI接続を解除しました。履歴は保持します。');return;}
  if(name==='grade')return gradeModal(id);
  if(name==='history')return historyModal(id);
  if(name==='next'){await draftQueue;await nextQuestion();}
  if(name==='variant'){
   const previous=state.answers.find(a=>a.id===id);
   const variant=available().find(q=>q.mode===previous.questionSnapshot.mode&&q.id!==previous.questionId&&!state.session.deferredQuestionIds.includes(q.id)&&q.grammar_tags.some(t=>previous.questionSnapshot.grammar_tags.includes(t)));
   if(variant){await openQuestion(variant.id);toast('同じ構文を別の文脈で確認します。難易度が異なる類題を含みます。');}else toast('この構文の別問題はありません。問題管理から追加できます。');
  }
  if(name==='quick-start')await startPractice('short');
  if(name==='category'){await mutate(s=>Core.updateSettings(s,{difficulty:state.questions.find(q=>q.grammar_tags.includes(id)&&q.mode==='short'&&q.active)?.difficulty||'standard'}));await startPractice('short',id);}
  if(name==='resume')navigate(state.questions.find(q=>q.id===state.session.currentQuestionId)?.mode||'short');
  if(name==='question')await openQuestion(id);
  if(name==='revise'){const a=state.answers.find(a=>a.id===id);await openQuestion(a.questionId,id);}
  if(name==='defer'){await mutate(s=>Core.deferQuestion(s,s.session.currentQuestionId));await nextQuestion();}
  if(name==='review-defer'){await mutate(s=>Core.deferQuestion(s,id));render();toast('このセッションでは同じ構文も後回しにします。');}
  if(name==='end-session'){await draftQueue;await mutate(s=>Core.updateSession(s,{currentQuestionId:null,currentAnswerId:null,parentAnswerId:null}));render();}
  if(name==='review-tab'){reviewTab=id;render();}
  if(name==='textbook')textbookModal();
  if(name==='textbook-book')textbookModal(id);
  if(name==='generate'){const q=generateVariant('relative-pronoun',state.questions.length),existing=available().find(x=>x.japanese===q.japanese);if(!existing)await mutate(s=>Core.addQuestion(s,q));toast(existing?'登録済みの類題を開きます。':'独自テンプレートの関係詞問題を追加しました。');await openQuestion(existing?.id||q.id);}
  if(name==='new-question')questionModal();
  if(name==='edit-question')questionModal(id);
  if(name==='hide-question'){const q=state.questions.find(q=>q.id===id);await mutate(s=>Core.hideQuestion(s,id,!(q.hidden||!q.active)));manageModal();}
  if(name==='delete-question'){if(confirm('出題用データを削除します。過去の答案・累積誤答・スナップショットは保持します。よろしいですか？')){await mutate(s=>Core.deleteQuestion(s,id));manageModal();}}
  if(name==='export')download(Core.exportBackup(state),`writing-backup-${Core.getJstDayKey()}.json`);
  if(name==='external-grade') {const input=$('#external-feedback').value;const e=JSON.parse(input);e.feedback=JSON.stringify({provenance:'external'});if(typeof e.reason!=='string'||!e.reason.trim())throw Error('意味・文法を比較した採点理由が必要です。');if(typeof e.confidence==='number'&&e.confidence<0.5){e.status='pending';e.score=null;e.rubric=null;toast('確信度が低いため判定保留で保存します。');}await saveGrade(id,e);}
  if(name==='feedback-prompt'){const a=state.answers.find(a=>a.id===id);modal(`<h2>外部添削者への依頼文</h2><p class="muted">必要ならコピーし、添削を依頼してください。元の主張と意味を保った改善案を求めます。</p><textarea rows="14" readonly>${esc(`日本語設問：${questionText(a.questionSnapshot)}\nユーザーの英文：${a.input}\n参考例（唯一の正解ではない）：${a.questionSnapshot.reference_answers.join(' / ')}\n設問と英文の意味、文法、自然さを比較し、正しい別解は認め、意味の取り違えは指摘してください。曖昧ならpending。元の主張を保った改善案を優先してください。JSONで status(correct/partial/incorrect/pending), score(${a.evaluation.maxScore}点満点), correctParts, grammarErrors, meaning, naturalness, improved, reason, errorCategories(${ERROR_CATEGORIES.map(c=>c.id).join(',')}から複数), confidence(0〜1) を返してください。自由英作文ではrubric={content,organization,grammar,vocabulary}各0〜5、合計20（公式採点基準ではない）も付けてください。`)}</textarea>${action('grade','採点に戻る',`data-id="${id}"`)}`);}
 }catch(error){toast(error.message);}
});
$('#modal').addEventListener('change',async event=>{if(event.target.id!=='writing-import')return;try{const file=event.target.files?.[0];if(!file)return;if(file.size>10*1024*1024)throw Error('10MB以下のJSONを選択してください。');const text=await file.text();await mutate(s=>Core.importBackup(s,text));render();manageModal();toast('バックアップを統合しました。');}catch(error){toast(`取り込みを中止：${error.message}`);if($('#import-error'))$('#import-error').textContent=error.message;}});
$('#manage-open').onclick=()=>{if(state)manageModal();else {try{const raw=localStorage.getItem(Core.STATE_KEY);if(raw)download(raw,'writing-recovery.json');}catch(error){toast(error.message);}}};
$('#ai-settings-open').onclick=()=>{if(state)aiSettingsModal();};
$('#theme-toggle').onclick=async()=>{if(!state)return;try{await draftQueue;await mutate(s=>Core.updateSettings(s,{theme:document.body.classList.contains('dark')?'light':'dark'}));render();}catch(error){toast(error.message);}};
window.addEventListener('hashchange',async()=>{await draftQueue.catch(()=>{});currentPage=location.hash.slice(1)||'dashboard';render();});
window.addEventListener('storage',event=>{if(event.key!==Core.STATE_KEY)return;try{const focused=$('#answer-input');const editing=focused&&document.activeElement===focused;state=Core.initializeState(localStorage,QUESTIONS);if(!editing)render();}catch(error){toast(error.message);}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state)decorateView();});
function decorateView() {
 if(!state)return;
 const aiButton=$('#ai-settings-open');if(aiButton)aiButton.textContent=aiReady()?'AI添削：有効':'AI添削の接続';
 const footer=$('footer span');if(footer)footer.textContent=aiReady()?'履歴は端末保存 · AI添削有効':'履歴は端末保存 · 手動採点';
 const grammarStatistics=currentPage==='grammar'?stats():[];
 if(currentPage==='dashboard') {
  const today=Core.getJstDayKey(), all=graded(),week=all.filter(a=>Date.now()>=Date.parse(a.submittedAt)&&Date.now()-Date.parse(a.submittedAt)<7*86400000),gs=stats();
  const metrics=[['今日の演習',state.answers.filter(a=>Core.getJstDayKey(a.submittedAt)===today).length,'問'],['現在の復習期限到来',available().filter(due).length,'問'],['直近7日間の正答率',pct(week.length?week.filter(a=>a.evaluation.status==='correct').length/week.length:null),''],['累積演習',state.answers.length,'問'],['累積誤答',Core.getMistakeCount(state),'件'],['定着済み構文',gs.filter(s=>s.mastered).length,'項目'],['未定着構文',gs.filter(s=>!s.mastered).length,'項目']];
  const grid=$('.stats',app);if(grid)grid.innerHTML=metrics.map(([label,n,unit])=>`<div class="stat"><span class="label">${label}</span><div class="number">${n}<small>${unit}</small></div></div>`).join('');
  const weakHeading=[...app.querySelectorAll('h2')].find(h=>h.textContent==='次に伸ばしたいところ');if(weakHeading)weakHeading.textContent='苦手な文法項目 TOP5';
  if(!$('#recent-answers'))app.insertAdjacentHTML('beforeend',`<section class="card" id="recent-answers"><h2>直近の学習履歴</h2>${state.answers.length?[...state.answers].reverse().slice(0,10).map(a=>`<div class="row"><div class="row-body"><strong>${esc(questionText(a.questionSnapshot))}</strong><p>${labels[a.evaluation.status]} · ${a.evaluation.score??'—'}点 · ${esc(Core.getJstDayKey(a.submittedAt))}</p></div>${action('history','答案を見る',`data-id="${a.id}"`)}</div>`).join(''):empty('まだ回答履歴はありません。')}</section>`);
 }
 if(currentPage==='grammar') for(const card of app.querySelectorAll('.category')) {
  if(card.querySelector('.grammar-extra'))continue;const id=card.querySelector('[data-action="category"]').dataset.id,s=grammarStatistics.find(s=>s.id===id),qs=available().filter(q=>q.grammar_tags.includes(id));
  const deadlines=qs.map(q=>schedule(q).dueAt).filter(Boolean).sort();const last=s.observations.at(-1)?.at;
  card.insertAdjacentHTML('beforeend',`<p class="muted grammar-extra">累積誤答 ${s.cumulativeMistakes} 件<br>最終演習 ${last?esc(Core.getJstDayKey(last)):'未演習'}<br>次回復習 ${deadlines.length?esc(Core.getJstDayKey(deadlines[0])):'未設定'}</p>`);
 }
 if(currentPage==='grammar'&&!$('#book-records'))app.insertAdjacentHTML('beforeend',`<section class="card" id="book-records"><h2>教材別の実施記録</h2>${Object.entries(state.textbookProgress).map(([book,p])=>`<div class="row"><div><strong>${esc(book)}</strong><p class="muted">${p.confirmedItems.map(n=>`第${n}項`).join('、')||'未記録'}</p></div>${action('textbook-book','編集',`data-id="${esc(book)}"`)}</div>`).join('')}</section>`);
 if(['short','essay'].includes(currentPage)){
  const a=state.answers.find(a=>a.id===state.session.currentAnswerId);const block=$('.feedback',app);
  if(a&&block&&a.evaluation.status==='pending'&&!block.querySelector('[data-action="ai-grade"]'))block.insertAdjacentHTML('beforeend',action('ai-grade','この答案をAIで採点',`data-id="${a.id}"`));
  if(a&&block&&!block.querySelector('.next-review')){const s=Core.getReviewSchedule(state,a.questionId);block.insertAdjacentHTML('beforeend',`<p class="notice next-review">次回復習：${s.dueAt?esc(new Date(s.dueAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))+'（日本時間）':'判定保留のため未設定'}</p>`);}
  if(a&&block&&['incorrect','partial'].includes(a.evaluation.status)&&!block.querySelector('[data-action="variant"]'))block.insertAdjacentHTML('beforeend',action('variant','同じ構文を別の文で確認',`data-id="${a.id}"`));
 }
 if(currentPage==='review'){
  if(!$('#review-summary'))app.insertAdjacentHTML('afterbegin',`<p id="review-summary" class="notice">期限到来 ${available().filter(due).length} 問 ／ 未定着 ${available().filter(q=>!schedule(q).mastered).length} 問。期限が0件でも、未定着の問題は残っています。</p>`);
  if(!$('#review-states'))app.insertAdjacentHTML('beforeend',`<section class="card" id="review-states"><h2>学習状態</h2><div class="stats">${[['unpracticed','未演習'],['waiting','復習待ち'],['due','復習期限到来'],['relearn','再学習必要'],['checking','定着確認中'],['mastered','定着済み']].map(([id,label])=>`<div class="stat"><span class="label">${label}</span><div class="number">${available().filter(q=>Core.getReviewState(state,q.id)===id).length}<small>問</small></div></div>`).join('')}</div><p class="muted">定着確認中は3段階以上の復習中、または採点保留を含みます。再学習必要の問題も、復習時刻を迎えると上の期限到来数に含まれます。</p></section>`);
 }
 if(currentPage==='analytics'&&!$('#mistake-trends')) {
  const answers=graded(),now=Date.now(),week=7*86400000,gs=stats(),fmt=rows=>rows.length?rows.map(s=>esc(s.label)).join('、'):'該当なし・記録不足';
  const improved=gs.filter(s=>s.attempts>=4&&s.trend>0.1),stagnant=gs.filter(s=>s.attempts>=5&&s.trend<=0&&now-Date.parse(s.observations[0].at)>=14*86400000);
  const growing=ERROR_CATEGORIES.filter(c=>{const n=days=>answers.filter(a=>now-Date.parse(a.submittedAt)<days*week&&now-Date.parse(a.submittedAt)>=(days-1)*week&&a.evaluation.errorCategories.includes(c.id)).length;return n(1)>n(2)&&n(1)>=2;});
  const series=Array.from({length:7},(_,i)=>{const key=Core.getJstDayKey(now-(6-i)*86400000);return {key,n:state.answers.filter(a=>a.mistakeCounted&&Core.getJstDayKey(a.submittedAt)===key).length};});
  app.insertAdjacentHTML('beforeend',`<section class="card" id="mistake-trends"><h2>誤答数の推移（日本時間・答案IDごとに1件）</h2><div class="spark-chart">${series.map(s=>`<div class="spark-column"><div style="height:${Math.min(s.n*12,80)+2}px" title="${s.n}件"></div>${s.key.slice(5)}<p>${s.n}件</p></div>`).join('')}</div><h3>改善した文法項目</h3><p>${fmt(improved)}</p><h3>2週間以上改善が見られない項目</h3><p>${fmt(stagnant)}</p><h3>最近増えているミス（直近7日とその前の7日）</h3><p>${growing.map(c=>esc(c.label)).join('、')||'該当なし・記録不足'}</p><h3>優先して復習する構文</h3>${gs.filter(s=>s.attempts).sort((a,b)=>a.mastery-b.mastery).slice(0,5).map(s=>`<div class="row"><span>${esc(s.label)} · 正答率 ${pct(s.accuracy)}</span>${action('category','復習',`data-id="${s.id}"`)}</div>`).join('')||empty('採点の蓄積後に表示します。')}<p class="muted">改善は4回答以上、長期停滞は5回答以上・14日経過を条件とする学習上の目安です。統計的に校正した能力予測ではありません。記録が少ない場合の推定精度は低くなります。</p></section>`);
 }
}
const baseRender=render;
render=function(){baseRender();document.querySelectorAll('#navigation a').forEach(link=>{if(link.classList.contains('active'))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});if(state)document.body.classList.toggle('dark',state.settings.theme==='dark'||(state.settings.theme===undefined&&matchMedia('(prefers-color-scheme: dark)').matches));decorateView();};
if(!loadError&&state.settings.theme===undefined&&matchMedia('(prefers-color-scheme: dark)').matches)document.body.classList.add('dark');
render();
async function enableOffline(){
 const status=$('#writing-offline');
 if(!('serviceWorker'in navigator)){status.textContent='オフライン機能は利用不可';return;}
 try{
  const registration=await navigator.serviceWorker.register('./sw.js');
  // Older vocabulary workers do not know writing.html. Activate the new shell
  // without reloading the editor; all current drafts stay in the current page.
  const activate=()=>registration.waiting?.postMessage({type:'SKIP_WAITING'});
  const watch=()=>{const worker=registration.installing;if(worker)worker.addEventListener('statechange',()=>{if(worker.state==='installed')activate();});};
  registration.addEventListener('updatefound',watch);watch();activate();
  navigator.serviceWorker.addEventListener('controllerchange',()=>{status.textContent='オフライン利用可';});
  if(navigator.onLine)await registration.update();watch();activate();
  await navigator.serviceWorker.ready;
  if(!registration.installing&&!registration.waiting)status.textContent='オフライン利用可';
 }catch(error){status.textContent='オフライン準備失敗';toast(`接続時に再読み込みしてください：${error.message}`);}
}
void enableOffline();
