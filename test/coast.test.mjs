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

test('Gdynia–Karlskrona corridor: shared fixed points with the same spacing and row offsets as Ventspils–Norvik', async () => {
  const fs = await import('node:fs');
  const { GK_ROUTE_POINTS, COAST_POINTS: workerCoast } = await import('../worker/forecast-points.mjs');
  const app = fs.readFileSync('dist/app.js', 'utf8');
  assert.deepEqual(JSON.parse(app.match(/const GK_ROUTE_POINTS=(\[.*?\]);/)[1]), GK_ROUTE_POINTS);
  assert.deepEqual(JSON.parse(app.match(/const COAST_POINTS=(\[.*?\]);/)[1]), workerCoast);
  assert(GK_ROUTE_POINTS.length > 40 && GK_ROUTE_POINTS.length <= 66);
  for (const p of GK_ROUTE_POINTS) {
    assert([-30, -22.5, -15, -7.5, 0, 7.5, 15].includes(p.offset));
    assert(p.lat > 54.4 && p.lat < 56.4 && p.lon > 15.3 && p.lon < 19.6, p.id);
  }
  assert.equal(new Set(GK_ROUTE_POINTS.map(p => p.id)).size, GK_ROUTE_POINTS.length);
  for (const area of ['gdynia', 'karlskrona']) assert(workerCoast.filter(p => p.area === area).length >= 8, area);
});

test('the route-gk group is served in batches of six for marine models', async () => {
  const { GK_ROUTE_POINTS } = await import('../worker/forecast-points.mjs');
  const api = createForecastAPI({
    now: () => Date.parse('2026-10-19T08:00:00Z'),
    fetcher: async url => {
      const u = new URL(url);
      if (u.pathname.includes('/static/meta.json')) return Response.json({ last_run_availability_time: 1760853600, last_run_initialisation_time: 1760853600, update_interval_seconds: 21600 });
      const lats = u.searchParams.get('latitude').split(','), lons = u.searchParams.get('longitude').split(',');
      return Response.json(lats.map((lat, i) => ({ latitude: Number(lat), longitude: Number(lons[i]), hourly: { time: [1760860800], wave_height: [0.8], wave_direction: [250], wave_period: [4.5] } })));
    },
  });
  let offset = 0, records = [];
  do {
    const response = await api(new Request('https://weather.seasync.co/api/forecast?model=ecmwf_wam&group=route-gk&offset=' + offset), {});
    assert.equal(response.status, 200);
    const data = await response.json(); records.push(...data.records); offset = data.nextOffset;
  } while (offset !== null);
  assert.deepEqual(records.map(r => r.id), GK_ROUTE_POINTS.map(p => p.id));
});

test('wide zoomed-out wind grid: one Open-Meteo request for all points, every wind model', async () => {
  const { FORECAST_GRIDS } = await import('../worker/forecast-points.mjs');
  let requests = 0, lastModels = null;
  const api = createForecastAPI({
    now: () => Date.parse('2026-10-19T08:00:00Z'),
    fetcher: async url => {
      const u = new URL(url);
      if (u.pathname.includes('/static/meta.json')) return Response.json({ last_run_availability_time: 1760853600, last_run_initialisation_time: 1760853600, update_interval_seconds: 10800 });
      requests++; lastModels = u.searchParams.get('models');
      const lats = u.searchParams.get('latitude').split(','), lons = u.searchParams.get('longitude').split(',');
      return Response.json(lats.map((lat, i) => ({ latitude: Number(lat), longitude: Number(lons[i]), hourly: { time: [1760860800], wind_speed_10m: [7], wind_gusts_10m: [11], wind_direction_10m: [250] } })));
    },
  });
  const response = await api(new Request('https://weather.seasync.co/api/forecast?model=icon_eu&group=wide-grid'), {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.records.length, FORECAST_GRIDS.wideGrid.length);
  assert.equal(data.nextOffset, null);
  assert.equal(requests, 1);
  // Regional models and SMHI get a whole-map field from a seamless blend / ECMWF.
  for (const [model, source] of [['dmi_harmonie', 'dmi_seamless'], ['metno_nordic', 'metno_seamless'], ['icon_d2', 'icon_seamless'], ['fmi_harmonie', 'ecmwf_ifs'], ['smhi_snow', 'ecmwf_ifs']]) {
    const before = requests, r = await api(new Request('https://weather.seasync.co/api/forecast?model=' + model + '&group=wide-grid'), {});
    assert.equal(r.status, 200, model);
    assert.equal(requests, before + 1, model);
    assert.equal(lastModels, source);
    assert.equal((await r.json()).records.length, FORECAST_GRIDS.wideGrid.length);
  }
  assert.equal((await api(new Request('https://weather.seasync.co/api/forecast?model=ecmwf_wam&group=wide-grid'), {})).status, 400);
  const fs = await import('node:fs');
  assert.deepEqual(JSON.parse(fs.readFileSync('dist/app.js', 'utf8').match(/const WIDE_GRID=(\[.*?\]);/)[1]), FORECAST_GRIDS.wideGrid);
});
