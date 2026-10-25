import test from 'node:test';
import assert from 'node:assert/strict';
import { createForecastAPI, prewarmTasks, balticAnchor, BALTIC_PARTS } from '../worker/forecast.mjs';
import { BALTIC_GRID } from '../worker/baltic-grid.mjs';

const NOW = Date.parse('2026-10-25T10:20:00Z'), HOUR = 3600000;

test('Baltic grid: hundreds of sea points ~27 km apart inside the Baltic box', () => {
  assert(BALTIC_GRID.length > 350 && BALTIC_GRID.length < 600, String(BALTIC_GRID.length));
  for (const p of BALTIC_GRID) assert(p.lat >= 53.8 && p.lat <= 66 && p.lon >= 9.8 && p.lon <= 30.4);
  // Nearest neighbour distance about the Ventspils–Norvik route spacing.
  const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180));
  const gaps = BALTIC_GRID.slice(0, 80).map(a => Math.min(...BALTIC_GRID.filter(b => b !== a).map(b => km(a, b)))).sort((a, b) => a - b);
  assert(gaps[40] > 22 && gaps[40] < 32, String(gaps[40]));
});

test('parts are anchored to 00/12 UTC and cover the next 72 hours', () => {
  const anchor = balticAnchor(NOW);
  assert.equal(new Date(anchor).toISOString(), '2026-10-25T00:00:00.000Z');
  assert(anchor <= NOW - HOUR && anchor + BALTIC_PARTS * 12 * HOUR >= NOW + 71 * HOUR);
  assert.equal(prewarmTasks().filter(t => t.group === 'baltic').length, 3 * BALTIC_PARTS);
});

test('ECMWF WAM Baltic map: whole grid in two Open-Meteo requests, sliced into 12-hour parts', async () => {
  let calls = 0;
  const api = createForecastAPI({ now: () => NOW, fetcher: async url => {
    const u = new URL(url);
    if (u.pathname.includes('/static/meta.json')) return Response.json({ last_run_availability_time: NOW / 1000 - 3600, last_run_initialisation_time: NOW / 1000 - 9 * 3600, update_interval_seconds: 21600 });
    calls++;
    assert.equal(u.searchParams.get('cell_selection'), 'sea');
    const lats = u.searchParams.get('latitude').split(','), start = Date.parse(u.searchParams.get('start_hour') + ':00Z') / 1000;
    const time = Array.from({ length: 97 }, (_, h) => start + h * 3600);
    return Response.json(lats.map((lat, i) => ({ latitude: +lat, longitude: 20, hourly: { time, wave_height: time.map(() => 1.234), wave_direction: time.map(() => 245.4), wave_period: time.map(() => 5) } })));
  } });
  const r0 = await (await api(new Request('https://marine.weather.seasync.co/api/forecast?model=ecmwf_wam&group=baltic&offset=0'), {})).json();
  const r1 = await (await api(new Request('https://marine.weather.seasync.co/api/forecast?model=ecmwf_wam&group=baltic&offset=1'), {})).json();
  assert.equal(calls, 2, 'one fetch of the whole grid for all parts');
  assert.equal(r0.times.length, 12); assert.equal(r0.times[0], balticAnchor(NOW) / 1000); assert.equal(r1.times[0], r0.times[11] + 3600);
  assert.equal(r0.hs.length, BALTIC_GRID.length); assert.equal(r0.lat.length, BALTIC_GRID.length);
  // Hours before the current one are not requested from Open-Meteo: empty; later hours filled and rounded.
  assert.equal(r0.hs[0][0], null); assert.equal(r0.hs[0][11], 1.23); assert.equal(r0.dir[5][11], 245);
  assert.equal(r1.nextOffset, 2);
  assert.equal((await api(new Request('https://marine.weather.seasync.co/api/forecast?model=fmi_wam&group=baltic&offset=0'), {})).status, 400);
  assert.equal((await api(new Request('https://marine.weather.seasync.co/api/forecast?model=ecmwf_wam&group=baltic&offset=9'), {})).status, 400);
});

// Minimal Copernicus store: uncompressed (memcpy) Blosc chunks of a 3×4 grid, two hours per chunk.
function blosc(floats) {
  const data = new Uint8Array(new Float32Array(floats).buffer), out = new Uint8Array(16 + data.length), v = new DataView(out.buffer);
  out[0] = 2; out[1] = 1; out[2] = 2; out[3] = 4; v.setUint32(4, data.length, true); v.setUint32(8, data.length, true); v.setUint32(12, out.length, true); out.set(data, 16);
  return out.buffer;
}
test('Copernicus Baltic map: full-domain chunks, nearest wet cell for coastal points', async () => {
  const lat = [54, 58, 62], lon = [12, 17, 22, 27], t0 = Date.parse('2026-10-01T00:00:00Z'), fetched = [];
  const root = 'https://s3.example/time.zarr/', zarr = shape => ({ chunks: [2, 3, 4], compressor: { id: 'blosc', cname: 'lz4' }, dtype: '<f4', fill_value: -9999999, filters: null, order: 'C', shape });
  const api = createForecastAPI({ now: () => NOW, fetcher: async url => {
    if (url.endsWith('product.stac.json')) return Response.json({ links: [{ rel: 'item', href: 'cmems_mod_bal_wav_anfc_PT1H-i_202311/dataset.stac.json' }] });
    if (url.endsWith('dataset.stac.json')) return Response.json({ properties: { admp_released_date: '2023-11-01', admp_updated_data: '2026-10-25T08:19:47Z' }, assets: { geoChunked: { href: 'x' }, timeChunked: { href: root.slice(0, -1), viewDims: { time: { coords: { min: t0 } } } } } });
    if (url === root + '.zmetadata') return Response.json({ metadata: { 'latitude/.zarray': { shape: [3] }, 'longitude/.zarray': { shape: [4] }, 'VHM0/.zarray': zarr([20000, 3, 4]), 'VMDR/.zarray': zarr([20000, 3, 4]) } });
    if (url === root + 'latitude/0') return new Response(blosc(lat));
    if (url === root + 'longitude/0') return new Response(blosc(lon));
    const m = url.match(/(VHM0|VMDR)\/(\d+)\.0\.0$/);
    if (m) { fetched.push(m[1] + m[2]); const k = Number(m[2]); return new Response(blosc(Array.from({ length: 24 }, (_, i) => { const cell = i % 12; if (cell === 0) return -9999999; return m[1] === 'VHM0' ? (2 * k + Math.floor(i / 12)) / 100 + cell : 200 + cell; }))); }
    throw Error('unexpected ' + url);
  } });
  const res = await api(new Request('https://marine.weather.seasync.co/api/forecast?model=copernicus_baltic&group=baltic&offset=0'), {});
  assert.equal(res.status, 200);
  const r = await res.json(), first = Math.round((balticAnchor(NOW) - t0) / HOUR);
  assert.equal(r.times.length, 12);
  assert.equal(fetched.filter(f => f.startsWith('VHM0')).length, 6, 'six 2-hour chunks for 12 hours');
  // The south-west point sits on the "land" cell (0,0): its nearest wet cell is used, not a gap.
  const sw = BALTIC_GRID.findIndex(p => p.lat < 55 && p.lon < 13);
  assert(r.hs[sw][0] != null && r.hs[sw][0] >= 1);
  assert.equal(Math.round((r.hs[sw][1] - r.hs[sw][0]) * 100), 1, 'consecutive hours from the chunk');
  assert.equal(r.timing.updatedAt, '2026-10-25T08:19:47Z');
  assert(first > 0);
});
