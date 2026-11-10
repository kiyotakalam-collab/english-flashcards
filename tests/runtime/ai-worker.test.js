import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('deploy bundle runs in workerd with SQLite Durable Object, authentication, deduplication and app-wide quota', async t => {
  const origin = 'https://kiyotakalam-collab.github.io', access = 'runtime-test-only-'.repeat(3), key = 'server-only-test-key';
  let paidCalls = 0; const upstream = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: await readFile('.wrangler/ai-check/worker.js', 'utf8'), compatibilityDate: '2026-11-01',
    bindings: { ALLOWED_ORIGIN: origin, APP_ACCESS_TOKEN: access, OPENAI_API_KEY: key, DAILY_LIMIT: '2' },
    durableObjects: { GRADING: { className: 'GradingService', useSQLite: true } },
    outboundService: async request => {
      paidCalls++; const body = await request.json();
      upstream.push({ url: request.url, auth: request.headers.get('Authorization'), body });
      return new Response(JSON.stringify({ id: 'resp_runtime', status: 'completed', model: 'runtime-mock', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        status: 'correct', score: 10, rubric: null, correctParts: '妥当です', grammarErrors: [], meaning: '一致します', naturalness: '自然です',
        improved: 'He is kind.', reason: '主語と補語が適切で意味も一致しています。', errorCategories: [], confidence: 0.9
      }) }] }] }));
    }
  }));
  t.after(() => mf.dispose());
  const send = (answerId = 'runtime-a', header = {}) => mf.dispatchFetch('http://worker/grade', { method: 'POST',
    headers: { Origin: origin, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', ...header },
    body: JSON.stringify({ answerId, question: { mode: 'short', japanese: '彼は親切だ。', reference_answers: ['He is nice.'], grammar_tags: ['sentence-pattern'], difficulty: 'basic' }, input: 'He is kind.' }) });
  assert.equal((await send('bad', { Authorization: 'Bearer invalid' })).status, 401);
  assert.equal((await send('bad', { Origin: 'https://other.example' })).status, 403);
  const responses = await Promise.all([send(), send(), send()]);
  for (const response of responses) {
    assert.equal(response.status, 200, await response.clone().text()); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    const result = await response.json(); assert.equal(result.evaluation.status, 'correct'); assert.ok(!JSON.stringify(result).includes(key));
  }
  assert.equal(paidCalls, 1);
  assert.equal(upstream[0].url, 'https://api.openai.com/v1/responses'); assert.equal(upstream[0].auth, `Bearer ${key}`);
  assert.equal(upstream[0].body.store, false); assert.equal(upstream[0].body.text.format.strict, true);
  const user = JSON.parse(upstream[0].body.input[0].content); assert.equal(user.question.japanese, '彼は親切だ。'); assert.equal(user.student_answer, 'He is kind.');
  assert.equal((await send('runtime-b')).status, 200);
  assert.equal((await send('runtime-c')).status, 429);
  assert.equal((await send()).status, 200); assert.equal(paidCalls, 2);
});
