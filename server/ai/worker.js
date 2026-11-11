import { validateAIRequest, validateGenerationRequest } from '../../writing-ai.js';
import { json, readJSON, callOpenAI, callGenerateQuestion } from './grading.js';

const RETENTION = 86400000;
async function hash(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ') || header.length > 512) return false;
  const left = await hash(header.slice(7)), right = await hash(secret);
  let diff = 0; for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return json({ error: 'origin_not_allowed' }, 403);
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
    const respond = response => { const r = new Response(response.body, response); for (const [key, value] of Object.entries(cors)) r.headers.set(key, value); return r; };
    const path=new URL(request.url).pathname;
    if (!['/grade','/generate'].includes(path)) return respond(json({ error: 'not_found' }, 404));
    if (request.method === 'OPTIONS') return respond(new Response(null, { status: 204, headers: { 'Access-Control-Max-Age': '600' } }));
    if (request.method !== 'POST') return respond(json({ error: 'method_not_allowed' }, 405));
    if (!env.OPENAI_API_KEY || !env.APP_ACCESS_TOKEN || !env.GRADING) return respond(json({ error: 'not_configured' }, 503));
    if (!await authorized(request, env.APP_ACCESS_TOKEN)) return respond(json({ error: 'unauthorized' }, 401));
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return respond(json({ error: 'json_required' }, 415));
    let input;
    try { const data=await readJSON(request); input=path==='/grade'?validateAIRequest(data):validateGenerationRequest(data); }
    catch { return respond(json({ error: 'invalid_request' }, 400)); }
    try {
      // One durable instance enforces an app-wide quota, even across edge locations.
      const service = env.GRADING.get(env.GRADING.idFromName('writing-v1'));
      return respond(await service.fetch(new Request(`https://internal${path}`, { method: 'POST', body: JSON.stringify(input) })));
    } catch { return respond(json({ error: 'service_unavailable' }, 503)); }
  }
};

export class GradingService {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.inFlight = new Map(); }
  async fetch(request) {
    let input;
    try { const data=await readJSON(request);input=new URL(request.url).pathname==='/generate'?validateGenerationRequest(data):validateAIRequest(data); } catch { return json({ error: 'invalid_request' }, 400); }
    if(new URL(request.url).pathname==='/generate') return this.generate(input);
    const key = `answer:${await hash(input.answerId)}`, digest = await hash(JSON.stringify(input));
    if (this.inFlight.has(key)) {
      const pending = this.inFlight.get(key);
      if (pending.digest !== digest) return json({ error: 'answer_conflict' }, 409);
      return (await pending.promise).clone();
    }
    const promise = this.grade(input, key, digest);
    this.inFlight.set(key, { digest, promise });
    try { return (await promise).clone(); } finally { this.inFlight.delete(key); }
  }
  async grade(input, key, digest) {
    const now = Date.now();
    const reservation = await this.ctx.blockConcurrencyWhile(async () => {
      const old = await this.ctx.storage.get(key);
      if (old && old.expires > now) {
        if (old.digest !== digest) return json({ error: 'answer_conflict' }, 409);
        if (old.result) return json(old.result);
        if (old.retryAt > now) return json({ error: 'answer_processing' }, 409);
      }
      const day = new Date(now).toISOString().slice(0, 10), minute = Math.floor(now / 60000);
      const quota = await this.ctx.storage.get('quota') || {};
      const daily = quota.day === day ? quota.daily : 0, recent = quota.minute === minute ? quota.recent : 0;
      const limit = (value, fallback, max) => /^\d+$/.test(String(value)) ? Math.min(max, Math.max(1, Number(value))) : fallback;
      if (daily >= limit(this.env.DAILY_LIMIT, 100, 1000) || recent >= limit(this.env.MINUTE_LIMIT, 10, 30)) return json({ error: 'quota_exceeded' }, 429, { 'Retry-After': '60' });
      await this.ctx.storage.put('quota', { day, daily: daily + 1, minute, recent: recent + 1 });
      // Reserve before any paid call. An interrupted call cannot be immediately retried.
      await this.ctx.storage.put(key, { digest, expires: now + RETENTION, retryAt: now + 120000 });
      if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(now + RETENTION);
      return null;
    });
    if (reservation) return reservation;
    const response = await callOpenAI(input, this.env);
    if (response.ok) await this.ctx.storage.put(key, { digest, expires: Date.now() + RETENTION, result: await response.clone().json() });
    return response;
  }
  async generate(input) {
    const now=Date.now();
    const reservation=await this.ctx.blockConcurrencyWhile(async()=>{
      const day=new Date(now).toISOString().slice(0,10),minute=Math.floor(now/60000);
      const quota=await this.ctx.storage.get('quota')||{};
      const daily=quota.day===day?quota.daily:0,recent=quota.minute===minute?quota.recent:0;
      const limit=(value,fallback,max)=>/^\d+$/.test(String(value))?Math.min(max,Math.max(1,Number(value))):fallback;
      if(daily>=limit(this.env.DAILY_LIMIT,100,1000)||recent>=limit(this.env.MINUTE_LIMIT,10,30))
        return json({error:'quota_exceeded'},429,{'Retry-After':'60'});
      await this.ctx.storage.put('quota',{day,daily:daily+1,minute,recent:recent+1});
      return null;
    });
    if(reservation)return reservation;
    return callGenerateQuestion(input,this.env);
  }
  async alarm() {
    const now = Date.now(); let next = Infinity, startAfter;
    while (true) {
      const entries = await this.ctx.storage.list({ prefix: 'answer:', limit: 1000, ...(startAfter ? { startAfter } : {}) });
      for (const [key, entry] of entries) {
        if (entry.expires <= now) await this.ctx.storage.delete(key); else next = Math.min(next, entry.expires);
        startAfter = key;
      }
      if (entries.size < 1000) break;
    }
    if (next !== Infinity) await this.ctx.storage.setAlarm(next);
  }
}
