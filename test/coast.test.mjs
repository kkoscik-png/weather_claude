import test from 'node:test';
import assert from 'node:assert/strict';
import { createForecastAPI } from '../worker/forecast.mjs';
import { COAST_POINTS } from '../worker/forecast-points.mjs';

test('coastal sea-state points: at least 8 near Ventspils and 8 on the Nynäshamn approach', () => {
  const ventspils = COAST_POINTS.filter(p => p.area === 'ventspils'), nynashamn = COAST_POINTS.filter(p => p.area === 'nynashamn');
  assert(ventspils.length >= 8);
  assert(nynashamn.length >= 8);
  for (const p of ventspils) assert(p.lat > 57.2 && p.lat < 57.6 && p.lon > 21.3 && p.lon < 21.7, p.name);
  for (const p of nynashamn) assert(p.lat > 58.65 && p.lat < 58.95 && p.lon > 17.75 && p.lon < 18.1, p.name);
  assert.equal(new Set(COAST_POINTS.map(p => p.id)).size, COAST_POINTS.length);
});

test('coastal group is served in batches of six for marine models', async () => {
  const requested = [];
  const api = createForecastAPI({
    now: () => Date.parse('2026-10-19T08:00:00Z'),
    fetcher: async url => {
      const u = new URL(url);
      if (u.pathname.includes('/static/meta.json')) return Response.json({ last_run_availability_time: 1760853600, last_run_initialisation_time: 1760853600, update_interval_seconds: 21600 });
      assert.equal(u.searchParams.get('cell_selection'), 'sea');
      const lats = u.searchParams.get('latitude').split(','), lons = u.searchParams.get('longitude').split(',');
      requested.push(...lats.map((lat, i) => [Number(lat), Number(lons[i])]));
      return Response.json(lats.map((lat, i) => ({ latitude: Number(lat), longitude: Number(lons[i]), hourly: { time: [1760860800], wave_height: [0.8], wave_direction: [250], wave_period: [4.5] } })));
    },
  });
  let offset = 0, records = [];
  do {
    const response = await api(new Request('https://pogoda.seasync.co/api/forecast?model=ecmwf_wam&group=coast&offset=' + offset), {});
    assert.equal(response.status, 200);
    const data = await response.json();
    records.push(...data.records);
    offset = data.nextOffset;
  } while (offset !== null);
  assert.equal(records.length, COAST_POINTS.length);
  assert.deepEqual(records.map(r => r.id), COAST_POINTS.map(p => p.id));
  assert.deepEqual(requested, COAST_POINTS.map(p => [p.lat, p.lon]));
});

test('DMI WAM reads a small cube around each coastal point to find a wet cell', async () => {
  const paths = [];
  const api = createForecastAPI({
    now: () => Date.parse('2026-10-19T08:00:00Z'), pause: async () => {},
    fetcher: async url => {
      const u = new URL(url); paths.push(u.pathname);
      if (u.pathname.endsWith('/instances')) return Response.json({ instances: [{ id: '2026-10-19T060000Z' }] });
      if (u.pathname.endsWith('/wam_nsb')) return Response.json({ extent: { temporal: { interval: [['2026-10-19T06:00:00Z', '2026-10-21T06:00:00Z']] } } });
      const [w, s, e, n] = u.searchParams.get('bbox').split(',').map(Number);
      return Response.json({ domain: { axes: { t: { values: ['2026-10-19T08:00:00Z'] }, x: { values: [w, (w + e) / 2, e] }, y: { values: [s, n] } } },
        ranges: { 'significant-wave-height': { axisNames: ['t', 'y', 'x'], shape: [1, 2, 3], values: [null, null, 1.1, null, null, null] } } });
    },
  });
  const response = await api(new Request('https://pogoda.seasync.co/api/forecast?model=dmi_wam&group=coast'), {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert(paths.some(p => p.endsWith('/cube')));
  assert(!paths.some(p => p.endsWith('/position')));
  assert.equal(data.records[0].hourly.wave_height[0], 1.1);
});
