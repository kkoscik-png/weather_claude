import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, assetCacheControl } from '../worker/index.mjs';

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
test('both public addresses serve the app', async () => {
  const { env } = assetsEnv();
  for (const host of ['weather.seasync.co', 'pogoda.seasync.co']) for (const path of ['/', '/app.js?v=1', '/api/stormglass/status']) assert.equal((await handler(request(path, host), env)).status, 200);
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
test('www. and http:// addresses redirect to the canonical HTTPS address', async () => {
  const { env, calls } = assetsEnv();
  const cases = [
    ['https://www.weather.seasync.co/?x=1', 'https://weather.seasync.co/?x=1'],
    ['http://www.pogoda.seasync.co/app.js', 'https://pogoda.seasync.co/app.js'],
    ['http://weather.seasync.co/', 'https://weather.seasync.co/'],
  ];
  for (const [from, to] of cases) {
    const response = await handler(new Request(from), env);
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('Location'), to);
  }
  assert.equal(calls(), 0);
  assert.equal((await handler(new Request('https://www.other.seasync.co/'), env)).status, 403);
});
test('the colour theme script loads from the site itself before the page paints', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync('dist/index.html', 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /<script src="theme\.js\?v=[^"]+"><\/script>/);
  assert(html.includes('data-theme-set="light"') && html.includes('data-theme-set="dark"'));
  assert(fs.readFileSync('dist/style.css', 'utf8').includes(':root[data-theme="dark"]'));
});
test('installable app: manifest with PNG and maskable icons, service worker at the root', async () => {
  const fs = await import('node:fs');
  const m = JSON.parse(fs.readFileSync('dist/manifest.webmanifest', 'utf8'));
  assert.equal(m.display, 'standalone'); assert.equal(m.start_url.startsWith('/'), true); assert.equal(m.id, '/');
  for (const size of ['192x192', '512x512']) {
    assert(m.icons.some(i => i.sizes === size && i.purpose === 'any' && i.type === 'image/png'));
    assert(m.icons.some(i => i.sizes === size && i.purpose === 'maskable'));
  }
  for (const i of m.icons) assert(fs.existsSync('dist/' + i.src), i.src);
  assert(fs.existsSync('dist/sw.js'));
  assert.equal(assetCacheControl(new URL('https://weather.seasync.co/sw.js')), 'no-cache');
  const html = fs.readFileSync('dist/index.html', 'utf8');
  assert(html.includes('rel="manifest" href="manifest.webmanifest"') && !html.includes('id="installApp"') && html.includes('id="iconStyleBtn"'));
});

test('every versioned asset in index.html carries the same version tag', async () => {
  const fs = await import('node:fs');
  const tags = new Set([...fs.readFileSync('dist/index.html', 'utf8').matchAll(/\?v=([\w.-]+)/g)].map(m => m[1]));
  // A stale tag on one file (e.g. style.css) keeps browsers on the old copy for a year.
  assert.equal(tags.size, 1, 'version tags: ' + [...tags].join(', '));
});
