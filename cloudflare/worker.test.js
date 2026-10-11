import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { RateLimitDO } from './worker.js';

class MemorySql {
  rows = [];
  exec(query, value) {
    if (query.startsWith('CREATE')) return { toArray: () => [] };
    if (query.startsWith('DELETE')) { this.rows = this.rows.filter((row) => row.at > value); return { toArray: () => [] }; }
    if (query.startsWith('SELECT')) return { toArray: () => [...this.rows].sort((a, b) => a.at - b.at).map((row) => ({ ...row })) };
    if (query.startsWith('INSERT')) { this.rows.push({ at: value }); return { toArray: () => [] }; }
    throw new Error('Unexpected SQL in test: ' + query);
  }
}

class MemoryLimiter {
  objects = new Map();
  idFromName(name) { return name; }
  get(id) {
    if (!this.objects.has(id)) {
      const sql = new MemorySql();
      const state = { storage: { sql, transactionSync: (fn) => fn() } };
      this.objects.set(id, new RateLimitDO(state));
    }
    const object = this.objects.get(id);
    return { fetch: (input, init) => object.fetch(new Request(input, init)) };
  }
}

const origin = 'https://ltwyz55-a11y.github.io';
const goodModelResult = (count = 2) => ({
  summary: { zh: '概括', en: 'Summary' },
  sharedStyle: { zh: '共同风格', en: 'Shared style' },
  elements: [{ label: { zh: '颜色', en: 'Color' }, value: { zh: '柔和', en: 'Soft' }, confidence: 'high' }],
  commonalities: { zh: ['色彩', '光线', '构图'], en: ['Palette', 'Light', 'Composition'] },
  variations: Array.from({ length: count }, (_, index) => ({ image: `参考图 ${index + 1}`, zh: '差异', en: 'Variation' })),
  template: { zh: '【主体】 风格', en: '[Subject] Style' },
  prompt: { zh: '中文提示词', en: 'English prompt' },
  confidenceNote: { zh: '置信度说明', en: 'Confidence note' },
});
const testImage = () => ({ name: 'test.png', mime: 'image/png', data: 'data:image/png;base64,iVBORw0KGgo=' });
const analysisRequest = (ip, body = {}) => new Request('https://worker.example/api/analyze', {
  method: 'POST',
  headers: { origin, 'cf-connecting-ip': ip, 'content-type': 'application/json' },
  body: JSON.stringify({ images: [testImage(), testImage()], subject: 'a cat', consent: true, ...body }),
});

test('Pages CORS is restricted and status never reveals the secret', async () => {
  const env = { GEMINI_API_KEY: 'secret-for-test', RATE_LIMITER: new MemoryLimiter() };
  const allowed = await worker.fetch(new Request('https://worker.example/api/status', { headers: { origin } }), env);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual(await allowed.json(), { ready: true });
  const denied = await worker.fetch(new Request('https://worker.example/api/status', { headers: { origin: 'https://evil.example' } }), env);
  assert.equal(denied.status, 403);
  assert.equal((await denied.text()).includes('secret-for-test'), false);
  const preflight = await worker.fetch(new Request('https://worker.example/api/analyze', { method: 'OPTIONS', headers: { origin } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
});

test('images cannot be submitted without explicit consent', async () => {
  const env = { GEMINI_API_KEY: 'test', RATE_LIMITER: new MemoryLimiter() };
  const response = await worker.fetch(analysisRequest('192.0.2.1', { consent: false }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, '请先确认图片处理说明。');
});

test('an accepted request returns the complete bilingual report and hides the key', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /gemini-3\.8-flash:generateContent$/);
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'test-secret');
    const sent = JSON.parse(init.body);
    assert.equal(sent.generationConfig.responseMimeType, 'application/json');
    assert.equal(sent.contents[0].parts.filter((part) => part.inlineData).length, 2);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(goodModelResult()) }] } }] });
  };
  const env = { GEMINI_API_KEY: 'test-secret', GEMINI_MODEL: 'gemini-3.8-flash', RATE_LIMITER: new MemoryLimiter() };
  const response = await worker.fetch(analysisRequest('192.0.2.2'), env);
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.result.prompt.zh, '中文提示词');
  assert.equal(payload.result.prompt.en, 'English prompt');
  assert.equal(payload.result.variations[1].image, '参考图 2');
  assert.equal(JSON.stringify(payload).includes('test-secret'), false);
});

test('the sixth valid attempt in one hour is blocked, and different IPs have separate counters', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('upstream down', { status: 500 }); };
  const limiter = new MemoryLimiter();
  const env = { GEMINI_API_KEY: 'test', RATE_LIMITER: limiter };
  for (let count = 0; count < 5; count += 1) {
    const response = await worker.fetch(analysisRequest('192.0.2.3'), env);
    assert.equal(response.status, 502);
  }
  const blocked = await worker.fetch(analysisRequest('192.0.2.3'), env);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(calls, 5);
  const otherIp = await worker.fetch(analysisRequest('192.0.2.4'), env);
  assert.equal(otherIp.status, 502);
  assert.equal(calls, 6);
});

test('quota is restored when the oldest request leaves the one-hour window', async (t) => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const sql = new MemorySql();
  const limiter = new RateLimitDO({ storage: { sql, transactionSync: (fn) => fn() } });
  const request = () => limiter.fetch(new Request('https://rate-limit.internal/consume', { method: 'POST' }));
  for (let count = 0; count < 5; count += 1) assert.equal((await (await request()).json()).allowed, true);
  assert.equal((await (await request()).json()).allowed, false);
  now += 60 * 60 * 1000 + 1;
  assert.equal((await (await request()).json()).allowed, true);
  assert.equal(sql.rows.length, 1);
});
