import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { GradingService } from '../server/ai/worker.js';
import { callOpenAI, callGenerateQuestion, readJSON } from '../server/ai/grading.js';
import { validateAIRequest, validateAIGrade, fetchAIGrade, normalizeEndpoint, validateGenerationRequest, validateGeneratedQuestion, fetchAIGeneratedQuestion, generationEndpoint } from '../writing-ai.js';
import * as Core from '../writing-core.js';
import { QUESTIONS } from '../writing-data.js';

const origin = 'https://kiyotakalam-collab.github.io', access = 'test-only-access-code-'.repeat(3);
const request = (id = 'answer-1') => ({ answerId: id, question: { mode: 'short', japanese: '私の姉は私に古い地図をくれた。',
  reference_answers: ['My sister gave me an old map.'], grammar_tags: ['sentence-pattern'], difficulty: 'basic' }, input: 'My sister gave an old map to me.' });
const grade = (patch = {}) => ({ status: 'correct', score: 10, rubric: null, correctParts: '意味を保持しています。',
  grammarErrors: [], meaning: '授与の意味が一致しています。', naturalness: '自然です。', improved: 'My sister gave an old map to me.',
  reason: 'give + 物 + to + 人という妥当な別解です。', errorCategories: [], confidence: 0.95, ...patch });
const provider = (evaluation = grade(), patch = {}) => new Response(JSON.stringify({ id: 'resp_test', model: 'gpt-4.1-mini', status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(evaluation) }] }], ...patch }));
const http = (input = request(), headers = {}, method = 'POST') => new Request('https://worker.example/grade', {
  method, headers: { Origin: origin, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', ...headers },
  ...(method === 'POST' ? { body: JSON.stringify(input) } : {}) });
function context() {
  const data = new Map(); let alarm = null, queue = Promise.resolve();
  return { data, storage: {
    async get(k) { return structuredClone(data.get(k)); }, async put(k, v) { data.set(k, structuredClone(v)); },
    async delete(k) { data.delete(k); }, async list({ prefix }) { return new Map([...data].filter(([k]) => k.startsWith(prefix))); },
    async getAlarm() { return alarm; }, async setAlarm(at) { alarm = at; }
  }, blockConcurrencyWhile(fn) { const p = queue.then(fn); queue = p.catch(() => {}); return p; } };
}
const envFor = (service, patch = {}) => ({ OPENAI_API_KEY: 'server-only-fake-key', APP_ACCESS_TOKEN: access, ALLOWED_ORIGIN: origin,
  GRADING: { idFromName: () => 'id', get: () => service }, ...patch });

test('worker rejects wrong origin, missing/bad credentials and accepts narrow CORS preflight', async () => {
  let calls = 0; const env = envFor({ fetch() { calls++; return new Response('{}'); } });
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: '' }]) {
    const r = await worker.fetch(http(request(), headers), env); assert.equal(r.status, 403); assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  }
  for (const auth of ['', 'Bearer wrong', 'Basic fake']) assert.equal((await worker.fetch(http(request(), { Authorization: auth }), env)).status, 401);
  const preflight = await worker.fetch(http(null, {}, 'OPTIONS'), env);
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type');
  assert.equal((await worker.fetch(http(), { ...env, OPENAI_API_KEY: '' })).status, 503);
  assert.equal(calls, 0);
});

test('server allowlists request fields and rejects huge, malformed and non-JSON bodies before provider', async () => {
  let calls = 0; const env = envFor({ fetch() { calls++; return new Response('{}'); } });
  assert.equal((await worker.fetch(http({ ...request(), input: 'x'.repeat(4001) }), env)).status, 400);
  assert.equal((await worker.fetch(http(request(), { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal((await worker.fetch(http({ ...request(), input: 'あ'.repeat(30000) }), env)).status, 400);
  await assert.rejects(readJSON(new Response('{' + 'x'.repeat(30)), 10));
  assert.deepEqual(validateAIRequest({ ...request(), apiKey: 'do-not-forward', allHistory: ['secret'] }), request());
  assert.equal(calls, 0);
});

test('Responses API uses secret only upstream, Japanese and English, strict schema and store:false', async () => {
  let sent;
  const response = await callOpenAI(request(), { OPENAI_API_KEY: 'only-on-server' }, async (url, init) => {
    sent = { url, ...init, body: JSON.parse(init.body) }; return provider();
  });
  assert.equal(response.status, 200); assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.headers.Authorization, 'Bearer only-on-server'); assert.equal(sent.body.store, false);
  assert.equal(sent.redirect, 'manual');
  assert.equal(sent.body.text.format.strict, true); assert.equal(sent.body.text.format.type, 'json_schema');
  const user = JSON.parse(sent.body.input[0].content); assert.equal(user.question.japanese, request().question.japanese); assert.equal(user.student_answer, request().input);
  assert.match(sent.body.instructions, /Accept any grammatical translation/);
  const result = await response.json(); assert.equal(result.evaluation.status, 'correct'); assert.equal(result.evaluation.score, 10);
  assert.equal(JSON.parse(result.evaluation.feedback).provenance, 'ai'); assert.ok(!JSON.stringify(result).includes('only-on-server'));
});

test('strict evaluation checks rubric, categories, low confidence and prevents false definitive scores', async () => {
  assert.throws(() => validateAIGrade(grade({ errorCategories: ['imaginary'] }), 'short'));
  assert.throws(() => validateAIGrade(grade({ errorCategories: ['article'] }), 'short'));
  assert.throws(() => validateAIGrade(grade({ score: 11 }), 'short'));
  assert.throws(() => validateAIGrade(grade({ reason: '' }), 'short'));
  const pending = validateAIGrade(grade({ confidence: 0.4 }), 'short');
  assert.equal(pending.status, 'pending'); assert.equal(pending.score, null); assert.equal(pending.rubric, null);
  const essay = grade({ score: 16, rubric: { content: 4, organization: 4, grammar: 4, vocabulary: 4 } });
  assert.equal(validateAIGrade(essay, 'essay').score, 16);
  assert.throws(() => validateAIGrade({ ...essay, score: 15 }, 'essay'));
  assert.throws(() => validateAIGrade({ ...essay, rubric: { content: 4, organization: 4, grammar: 4, fake: 4 } }, 'essay'));
  for (const body of [{ status: 'incomplete' }, { output: [{ type: 'message', content: [{ type: 'refusal' }] }] }]) {
    assert.ok(!(await callOpenAI(request(), {}, async () => provider(grade(), body))).ok);
  }
  assert.equal((await callOpenAI(request(), {}, async () => new Response('private provider error', { status: 401 }))).status, 503);
});

test('Japanese explanation policy reaches OpenAI while English corrections and quoted mistakes survive unchanged', async () => {
  const expected = grade({ status: 'partial', score: 6,
    correctParts: '主語と目的語の選び方は適切です。',
    grammarErrors: ['"give" は過去の出来事なので "gave" に修正します。'],
    meaning: '姉が地図をくれたという意味は伝わっています。',
    naturalness: '"an old map" とすると冠詞も適切になります。',
    improved: 'My sister gave an old map to me.',
    reason: '時制と冠詞を直せば、設問の意味を保った自然な英文になります。', errorCategories: ['tense', 'article'] });
  let instructions;
  const response = await callOpenAI({ ...request(), input: 'My sister give old map to me.' }, {}, async (_url, init) => {
    instructions = JSON.parse(init.body).instructions; return provider(expected);
  });
  assert.match(instructions, /All explanatory and evaluative prose MUST be written in natural Japanese, never English/);
  for (const field of ['correctParts', 'grammarErrors', 'meaning', 'naturalness', 'reason']) assert.ok(instructions.includes(field));
  assert.match(instructions, /English is allowed ONLY for the student's original English quotations, improved English sentences, and English-specific grammatical examples/);
  assert.match(instructions, /Do not translate corrected English sentences into Japanese/);
  const actual = (await response.json()).evaluation;
  for (const field of ['correctParts', 'grammarErrors', 'meaning', 'naturalness', 'reason', 'improved']) assert.deepEqual(actual[field], expected[field]);
  assert.deepEqual(actual.errorCategories, ['tense', 'article']);
  assert.equal(actual.improved, 'My sister gave an old map to me.');
});

test('durable idempotency handles simultaneous retry, edge restart, conflicts and expired retention', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return provider(); });
  const ctx = context(), env = { OPENAI_API_KEY: 'fake' }, service = new GradingService(ctx, env);
  const send = (s = service, body = request()) => s.fetch(new Request('https://internal/grade', { method: 'POST', body: JSON.stringify(body) }));
  const results = await Promise.all([send(), send(), send()]);
  assert.deepEqual(await results[0].json(), await results[1].json()); assert.equal(calls, 1);
  assert.equal((await send(new GradingService(ctx, env))).status, 200); assert.equal(calls, 1);
  assert.equal((await send(service, { ...request(), input: 'changed answer' })).status, 409);
  const cached = [...ctx.data].find(([k]) => k.startsWith('answer:')); cached[1].expires = 0; ctx.data.set(...cached);
  await service.alarm(); assert.equal([...ctx.data.keys()].filter(k => k.startsWith('answer:')).length, 0);
});

test('daily and minute quotas persist across instances; failed calls reserve before provider and never expose secrets', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('secret error', { status: 500 }); });
  const ctx = context(), env = { OPENAI_API_KEY: 'not-in-response', DAILY_LIMIT: '1' };
  const send = (id) => new GradingService(ctx, env).fetch(new Request('https://internal/grade', { method: 'POST', body: JSON.stringify(request(id)) }));
  const failed = await send('a1'); assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('secret'));
  assert.equal((await send('a1')).status, 409); assert.equal((await send('a2')).status, 429); assert.equal(calls, 1);
  const minuteContext = context(), minuteEnv = { ...env, DAILY_LIMIT: '10', MINUTE_LIMIT: '1' };
  const inMinute = id => new GradingService(minuteContext, minuteEnv).fetch(new Request('https://internal/grade', { method: 'POST', body: JSON.stringify(request(id)) }));
  assert.equal((await inMinute('m1')).status, 503); assert.equal((await inMinute('m2')).status, 429); assert.equal(calls, 2);
});

test('AI grading integrates with immutable answer, audit, monotonic mistakes, schedule and backup once', async () => {
  let s = Core.createState(QUESTIONS), now = Date.now();
  s = Core.submitAnswer(s, { id: 'ai-answer', questionId: QUESTIONS[0].id, input: request().input, method: 'ai' }, now);
  const wrong = validateAIGrade(grade({ status: 'incorrect', score: 2, grammarErrors: ['例のエラー'], errorCategories: ['agreement'] }), 'short');
  s = Core.gradeAnswer(s, 'ai-answer', { ...wrong, feedback: JSON.stringify({ provenance: 'ai', model: 'test' }) }, now + 1);
  assert.equal(Core.getMistakeCount(s), 1); assert.equal(s.answers[0].method, 'ai');
  assert.equal(Core.getReviewSchedule(s, QUESTIONS[0].id).lastResult, 'incorrect');
  s = Core.gradeAnswer(s, 'ai-answer', { ...grade(), feedback: JSON.stringify({ provenance: 'manual' }) }, now + 2);
  assert.equal(Core.getMistakeCount(s), 1); assert.equal(s.answers[0].audit.length, 2);
  const restored = Core.importBackup(Core.createState(QUESTIONS), Core.exportBackup(s));
  assert.deepEqual(Core.importBackup(restored, Core.exportBackup(s)).answers, restored.answers);
});

test('browser transport rejects response ID mismatch, unsupported endpoints and does not retry failed API', async () => {
  assert.throws(() => normalizeEndpoint('http://example.com/grade')); assert.throws(() => normalizeEndpoint('https://user:secret@example.com/grade'));
  assert.throws(() => normalizeEndpoint('https://example.com/grade?token=secret'));
  let calls = 0; const answer = { id: 'answer-1', questionSnapshot: request().question, input: request().input };
  await assert.rejects(fetchAIGrade('https://test.example/grade', access, answer, { fetcher: async () => { calls++; return new Response('{}', { status: 503 }); } }));
  assert.equal(calls, 1);
  await assert.rejects(fetchAIGrade('https://test.example/grade', access, answer, { fetcher: async () => new Response(JSON.stringify({ answerId: 'different', evaluation: grade() })) }));
});

test('AI question generation validates topic, varies contexts and never sends provider key to the browser', async () => {
  const input={mode:'short',difficulty:'advanced',grammarTag:'relative-pronoun',recentPrompts:['私が昨日会った人は医師だ。']};
  assert.deepEqual(validateGenerationRequest({...input,privateAnswer:'should not leak'}),input);
  assert.throws(()=>validateGenerationRequest({...input,grammarTag:'not-a-real-grammar'}));
  assert.equal(generationEndpoint('https://worker.example/grade'),'https://worker.example/generate');
  const generated={japanese:'この地域で長年働いている人々は、環境の変化に敏感だ。',reference:'People who have worked in this region for years are sensitive to environmental changes.',explanation:'関係代名詞whoがpeopleを修飾します。'};
  assert.deepEqual(validateGeneratedQuestion(generated,input),generated);
  assert.throws(()=>validateGeneratedQuestion({...generated,japanese:input.recentPrompts[0]},input));
  let called;
  const providerResponse=new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(generated)}]}]}));
  const response=await callGenerateQuestion(input,{OPENAI_API_KEY:'server-secret'},async (url,options)=>{
    called={url,headers:options.headers,body:JSON.parse(options.body)};
    return providerResponse;
  });
  assert.equal(response.status,200);
  assert.equal(called.url,'https://api.openai.com/v1/responses');
  assert.equal(called.body.store,false);
  assert.equal(called.body.text.format.strict,true);
  assert.equal(JSON.parse(called.body.input[0].content).grammarName,'関係代名詞');
  assert.deepEqual((await response.json()).question,generated);
  let browserRequest;
  const client=await fetchAIGeneratedQuestion('https://worker.example/grade',access,input,{fetcher:async (url,options)=>{
    browserRequest={url,options};return new Response(JSON.stringify({question:generated}),{status:200});
  }});
  assert.deepEqual(client,generated);
  assert.equal(browserRequest.url,'https://worker.example/generate');
  assert.equal(browserRequest.options.headers.Authorization,`Bearer ${access}`);
  assert.ok(!browserRequest.options.body.includes('server-secret'));
});

test('AI generation Worker rejects unauthenticated calls, and uses shared rate limit with grading', async t => {
  const input={mode:'short',difficulty:'basic',grammarTag:'relative-pronoun',recentPrompts:[]};
  const ctx=context(),env=envFor(new GradingService(ctx,{OPENAI_API_KEY:'server-only',DAILY_LIMIT:'1'}));
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({japanese:'あの町で育った友人は今教師だ。',reference:'My friend who grew up in that town is now a teacher.',explanation:'関係代名詞whoの用法。'})}]}]}));});
  const send=(authorization=`Bearer ${access}`)=>new Request('https://worker.example/generate',{method:'POST',
    headers:{Origin:origin,Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await worker.fetch(send('Bearer invalid'),env)).status,401);
  assert.equal((await worker.fetch(send(),env)).status,200);
  assert.equal((await worker.fetch(send(),env)).status,429);
  assert.equal(calls,1);
});
