import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../worker/index.mjs';

const handler = createHandler();
const request = (path = '/', host = 'weather.seasync.co', assertion) => new Request('https://' + host + path, { headers: assertion ? { 'Cf-Access-Jwt-Assertion': assertion } : {} });
function assetsEnv(extra = {}) {
  let calls = 0;
  return { env: { ...extra, ASSETS: { async fetch() { calls++; return new Response('weather app'); } } }, calls: () => calls };
}

test('HTML and assets open anonymously without Access configuration', async () => {
  const { env, calls } = assetsEnv();
  const expected = {
    '/': 'no-cache',
    '/index.html': 'no-cache',
    '/app.js': 'no-cache',
    '/app.js?v=build-1': 'public, max-age=31536000, immutable',
    '/style.css?v=build-1': 'public, max-age=31536000, immutable',
    '/assets/leaflet.js': 'public, max-age=604800, stale-while-revalidate=86400',
  };
  for (const [path, cacheControl] of Object.entries(expected)) {
    const response = await handler(request(path), env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'weather app');
    assert.equal(response.headers.get('Cache-Control'), cacheControl, path);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'(;|$)/);
  }
  assert.equal(calls(), Object.keys(expected).length);
});
test('missing assets are never cached by the browser', async () => {
  const env = { ASSETS: { async fetch() { return new Response('not found', { status: 404 }); } } };
  const response = await handler(request('/missing.js?v=1'), env);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
test('legacy Access settings and assertions do not require a login', async () => {
  const { env } = assetsEnv({ ACCESS_TEAM_DOMAIN: 'old.cloudflareaccess.com', ACCESS_AUD: 'old-audience' });
  assert.equal((await handler(request('/', 'weather.seasync.co', 'expired.or.invalid'), env)).status, 200);
});
test('alternate hostnames cannot serve assets or API', async () => {
  const { env, calls } = assetsEnv();
  for (const path of ['/', '/app.js', '/api/stormglass/status']) assert.equal((await handler(request(path, 'other.workers.dev'), env)).status, 403);
  assert.equal(calls(), 0);
});
test('a missing asset binding reports an incomplete deployment', async () => {
  assert.equal((await handler(request(), {})).status, 503);
});
test('anonymous Stormglass status never exposes the server secret', async () => {
  const secret = 'test-server-secret';
  const { env, calls } = assetsEnv({ STORMGLASS_API_KEY: secret });
  const response = await handler(request('/api/stormglass/status'), env);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes(secret), false);
  assert.deepEqual(JSON.parse(body), { configured: true, routeEnabled: false, source: 'sg', cacheHours: 6 });
  assert.equal(calls(), 0);
});
test('Stormglass without a runtime secret reports 503 without serving assets', async () => {
  const { env, calls } = assetsEnv();
  const response = await handler(request('/api/stormglass/waves?group=ports'), env);
  assert.equal(response.status, 503);
  assert.equal(calls(), 0);
});
