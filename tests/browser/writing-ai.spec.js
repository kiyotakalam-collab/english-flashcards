import { test, expect } from '@playwright/test';

const writingKey = 'kotoba_writing_v1', configKey = 'kotoba_writing_ai_endpoint_v1', accessKey = 'kotoba_writing_ai_access_v1';
const endpoint = 'https://writing-api.example.test/grade', access = 'not-a-provider-key-test-access-123456789';
const saved = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), writingKey);
const evaluation = (patch = {}) => ({ status: 'correct', score: 10, rubric: null, confidence: 0.95,
  errorCategories: [], correctParts: '意味を保持した別解です。', grammarErrors: [], meaning: '設問の意味と一致します。', naturalness: '自然です。',
  improved: 'My sister gave an old map to me.', reason: 'give + 物 + to + 人が文法的にも正しいためです。',
  feedback: JSON.stringify({ provenance: 'ai', model: 'mock-openai', responseId: 'resp_mock' }), ...patch });

async function connect(page) {
  await page.goto('writing.html');
  await page.locator('#ai-settings-open').click();
  await page.locator('#ai-settings-form [name="endpoint"]').fill(endpoint);
  await page.locator('#ai-settings-form [name="access"]').fill(access);
  await page.locator('#ai-settings-form [type="submit"]').click();
  await expect(page.locator('#ai-settings-open')).toHaveText('AI添削：有効');
}
async function begin(page, mode = 'short') {
  await page.locator(`#navigation [data-page="${mode}"]`).click();
  await page.locator('#session-form [name="difficulty"]').selectOption(mode === 'essay' ? 'advanced' : 'basic');
  await page.locator('#session-form [type="submit"]').click();
  await expect(page.locator('#answer-input')).toBeEditable();
}
async function mockAPI(page, evaluate, options = {}) {
  const requests = [];
  await page.route(endpoint, async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const input = route.request().postDataJSON(); requests.push({ input, auth: route.request().headers().authorization });
    if (options.wait) await options.wait();
    if (options.status) return route.fulfill({ status: options.status, headers, json: { error: 'provider_unavailable' } });
    return route.fulfill({ status: 200, headers, json: { answerId: input.answerId, evaluation: evaluate(input) } });
  });
  return requests;
}

test('one click automatically grades an alternate answer and saves classified review without touching other subjects', async ({ page }) => {
  await page.addInitScript(() => { for (const [key, value] of Object.entries({ ex_flashcards_pwa_v2: 'vocab-kept', world_history_v1: 'history-kept' })) localStorage.setItem(key, value); });
  const requests = await mockAPI(page, () => evaluation());
  await connect(page); await begin(page);
  await page.locator('#answer-input').fill('My sister gave an old map to me.');
  await page.locator('[data-action="submit"]').evaluate(button => { button.click(); button.click(); });
  await expect(page.locator('.feedback')).toContainText('OpenAIによる自動添削');
  const s = await saved(page); expect(s.answers).toHaveLength(1); expect(s.answers[0].method).toBe('ai');
  expect(s.answers[0].evaluation.status).toBe('correct'); expect(s.answers[0].audit).toHaveLength(1);
  await expect(page.locator('.next-review')).not.toContainText('未設定'); expect(requests).toHaveLength(1);
  expect(requests[0].auth).toBe(`Bearer ${access}`); expect(requests[0].input.question.japanese).toBeTruthy();
  expect(requests[0].input.input).toBe('My sister gave an old map to me.'); expect(Object.keys(requests[0].input).sort()).toEqual(['answerId', 'input', 'question']);
  expect(await page.evaluate(() => [localStorage.getItem('ex_flashcards_pwa_v2'), localStorage.getItem('world_history_v1')])).toEqual(['vocab-kept', 'history-kept']);
  const exportData = JSON.stringify(s); expect(exportData).not.toContain(access); expect(exportData).not.toContain(endpoint);
  await page.reload(); await expect(page.locator('.feedback')).toContainText('OpenAIによる自動添削');
});

test('failed AI preserves pending answer; retry grades the same event, and manual correction retains cumulative error', async ({ page }) => {
  await mockAPI(page, () => evaluation(), { status: 503 });
  await connect(page); await begin(page); await page.locator('#answer-input').fill('My sister give me map.');
  await page.locator('[data-action="submit"]').click();
  await expect(page.locator('#modal')).toContainText('AI採点を完了できませんでした');
  const failed = await saved(page); expect(failed.answers).toHaveLength(1); expect(failed.answers[0].evaluation.status).toBe('pending'); expect(failed.answers[0].mistakeCounted).toBe(false);
  await page.unroute(endpoint);
  await mockAPI(page, () => evaluation({ status: 'incorrect', score: 3, grammarErrors: ['give → gave'], errorCategories: ['tense', 'article'] }));
  await page.locator('[data-action="ai-grade"]').last().click();
  await expect(page.locator('.feedback')).toContainText('時制');
  const success = await saved(page); expect(success.answers).toHaveLength(1); expect(success.answers[0].id).toBe(failed.answers[0].id);
  expect(success.answers[0].mistakeCounted).toBe(true); expect(success.answers[0].audit).toHaveLength(1);
  await page.locator('[data-action="grade"]').first().click();
  await page.locator('#grade-form [name="status"]').selectOption('correct');
  await page.locator('#grade-form [name="score"]').fill('10');
  await page.locator('#grade-form [name="reason"]').fill('添削者が妥当な別解と再判定したため。');
  await page.locator('#grade-form [type="submit"]').click(); await expect(page.locator('#grade-form')).not.toBeVisible();
  const corrected = await saved(page); expect(corrected.answers[0].evaluation.status).toBe('correct'); expect(corrected.answers[0].mistakeCounted).toBe(true);
  expect(corrected.answers[0].audit).toHaveLength(2);
});

test('essay auto evaluation uses 4x5 rubric; low-confidence grades stay pending without mistakes', async ({ page }) => {
  await mockAPI(page, input => evaluation({ score: 16, rubric: { content: 4, organization: 4, grammar: 4, vocabulary: 4 }, confidence: input.input.includes('uncertain') ? 0.4 : 0.9 }));
  await connect(page); await begin(page, 'essay'); await page.locator('#answer-input').fill('I believe students learn by explaining their ideas to each other.');
  await page.locator('[data-action="submit"]').click(); await expect(page.locator('.feedback')).toContainText('16 / 20');
  await page.locator('[data-action="revise"]').click(); await expect(page.locator('#answer-input')).toBeEditable();
  await page.locator('#answer-input').fill('I am uncertain about this question.'); await page.locator('[data-action="submit"]').click();
  await expect(page.locator('.feedback .pill').first()).toHaveText('判定保留');
  const s = await saved(page); expect(s.answers).toHaveLength(2); expect(s.answers[1].evaluation.score).toBe(null); expect(s.answers[1].mistakeCounted).toBe(false);
});

test('late AI result cannot overwrite a manual correction made while the request is running', async ({ page }) => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  await mockAPI(page, () => evaluation({ status: 'incorrect', score: 1, errorCategories: ['meaning'] }), { wait: () => wait });
  await connect(page); await begin(page); await page.locator('#answer-input').fill('An answer to be checked.');
  await page.locator('[data-action="submit"]').click(); await expect(page.locator('#modal')).toContainText('AI採点中');
  await page.locator('#modal-close').click(); await page.locator('[data-action="grade"]').first().click();
  await page.locator('#grade-form [name="status"]').selectOption('correct'); await page.locator('#grade-form [name="score"]').fill('10');
  await page.locator('#grade-form [name="reason"]').fill('先に手動で正解と確認しました。'); await page.locator('#grade-form [type="submit"]').click();
  await expect(page.locator('#grade-form')).not.toBeVisible(); release();
  await expect(page.locator('#toast')).toContainText('上書きしませんでした');
  const s = await saved(page); expect(s.answers[0].evaluation.status).toBe('correct'); expect(s.answers[0].audit).toHaveLength(1); expect(s.answers[0].mistakeCounted).toBe(false);
});

test('offline submission keeps answer and session credential never enters persistent backup or app files', async ({ page, context }) => {
  await connect(page); await begin(page);
  await page.locator('#answer-input').fill('Offline draft survives.');
  await context.setOffline(true); await page.locator('[data-action="submit"]').click();
  await expect(page.locator('#modal')).toContainText('AI採点を完了できませんでした');
  expect((await saved(page)).answers[0].input).toBe('Offline draft survives.');
  expect((await saved(page)).answers[0].evaluation.status).toBe('pending');
  expect(await page.evaluate(k => localStorage.getItem(k), accessKey)).toBe(null);
  await context.setOffline(false); await page.reload(); await expect(page.locator('#answer-input')).toHaveValue('Offline draft survives.');
  await page.locator('#ai-settings-open').click(); await page.locator('[data-action="ai-disconnect"]').click();
  expect(await page.evaluate(k => sessionStorage.getItem(k), accessKey)).toBe(null);
  expect(await page.evaluate(k => localStorage.getItem(k), configKey)).toBe(null);
  expect((await saved(page)).answers).toHaveLength(1);
});
