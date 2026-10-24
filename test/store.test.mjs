import test from 'node:test';
import assert from 'node:assert/strict';
import { ForecastStore, remoteStore } from '../worker/store.mjs';
import { createForecastAPI, prewarmTasks } from '../worker/forecast.mjs';
import { createScheduled } from '../worker/index.mjs';

// In-memory stand-in for a Durable Object namespace with SQLite KV storage.
function fakeNamespace() {
  const data = new Map(), stats = { gets: 0, puts: 0 };
  const storage = {
    async get(k) { stats.gets++; if (Array.isArray(k)) { assert(k.length <= 128, 'storage.get takes at most 128 keys'); return new Map(k.filter(x => data.has(x)).map(x => [x, data.get(x)])); } return data.get(k); },
    async put(obj) { stats.puts++; for (const [k, v] of Object.entries(obj)) data.set(k, v); },
  };
  const object = new ForecastStore({ storage });
  return { data, stats, idFromName: n => n, get: () => ({ fetch: (url, init) => object.fetch(new Request(url, init)) }) };
}

const NOW = Date.parse('2026-10-21T10:20:00Z'), START = Date.parse('2026-10-21T09:00:00Z') / 1000;
function openMeteo(url) {
  const u = new URL(url), lats = u.searchParams.get('latitude').split(','), lons = u.searchParams.get('longitude').split(',');
  return lats.map((lat, i) => ({ latitude: +lat, longitude: +lons[i], hourly: { time: Array.from({ length: 97 }, (_, h) => START + h * 3600), wind_speed_10m: Array(97).fill(6), wind_gusts_10m: Array(97).fill(9), wind_direction_10m: Array(97).fill(200) } }));
}
const meta = () => Response.json({ last_run_availability_time: NOW / 1000 - 1800, last_run_initialisation_time: NOW / 1000 - 9000, update_interval_seconds: 10800 });

test('store keeps values with a due time and lists due keys in chunks of 128', async () => {
  const ns = fakeNamespace(), store = remoteStore({ FORECAST_STORE: ns });
  await store.put('c/a', { x: 1 }, NOW + 1000);
  await store.put('c/b', { x: 2 }, NOW - 1000);
  assert.deepEqual(await store.get('c/a'), { x: 1 });
  assert.equal(await store.get('c/missing'), null);
  const keys = ['c/a', 'c/b', ...Array.from({ length: 300 }, (_, i) => 'c/n' + i)];
  const due = await store.due(keys, NOW);
  assert(!due.includes('c/a'), 'fresh value is not due');
  assert(due.includes('c/b') && due.includes('c/n299'));
  assert.equal(remoteStore({}), null);
});

test('a forecast fetched in one location is served from the shared store in another', async () => {
  const ns = fakeNamespace(), env = { FORECAST_STORE: ns };
  let upstream = 0;
  const fetcher = async url => { if (new URL(url).pathname.endsWith('/static/meta.json')) return meta(); upstream++; return Response.json(openMeteo(url)); };
  // Two Worker instances with separate per-location caches (no Cache API here) and one shared store.
  const a = createForecastAPI({ fetcher, now: () => NOW }), b = createForecastAPI({ fetcher, now: () => NOW });
  const req = () => new Request('https://weather.seasync.co/api/forecast?model=icon_eu&group=ports');
  assert.equal((await a(req(), env)).status, 200);
  assert.equal(upstream, 1);
  const r = await b(req(), env);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).records.length, 5);
  assert.equal(upstream, 1, 'second location reads the shared store, not the provider');
});

test('scheduled pre-fetch runs only due entries, ports first, then nothing until the next cycle', async () => {
  const ns = fakeNamespace(), env = { FORECAST_STORE: ns, ASSETS: { fetch: async () => new Response('') } };
  const requested = [];
  const api = createForecastAPI({ now: () => NOW, fetcher: async url => { if (new URL(url).pathname.endsWith('/static/meta.json')) return meta(); return Response.json(openMeteo(url)); } });
  const call = async request => { const u = new URL(request.url); requested.push(u.searchParams.get('model') + '/' + u.searchParams.get('group')); return (await api(request, env)) || new Response(null, { status: 404 }); };
  const first = await api.prewarm(env, call, { limit: 3, concurrency: 1 });
  assert.equal(first.total, prewarmTasks().length);
  assert.equal(first.ran + first.failed, 3);
  assert.deepEqual(requested, ['icon_eu/ports', 'ecmwf_ifs/ports', 'smhi_snow/ports']);
  // icon_eu and ecmwf_ifs came from Open-Meteo; they are no longer due within their cycle.
  requested.length = 0;
  await api.prewarm(env, call, { limit: 2, concurrency: 1 });
  assert(!requested.includes('icon_eu/ports') && !requested.includes('ecmwf_ifs/ports'));
  assert.deepEqual(await createForecastAPI().prewarm({}, call), { skipped: 'no store' });
});

test('the Worker cron uses a separate invocation per entry when ctx.exports is available', async () => {
  const ns = fakeNamespace(), calls = [];
  const scheduled = createScheduled(async () => new Response('in-process'));
  const ctx = { exports: { default: { fetch: async request => { calls.push(new URL(request.url).search); return new Response('{}'); } } } };
  const log = console.log; console.log = () => {};
  try { await scheduled({}, { FORECAST_STORE: ns }, ctx); } finally { console.log = log; }
  assert.equal(calls.length, 16, 'up to 16 due entries per run');
  assert(calls[0].includes('group=ports'));
});
