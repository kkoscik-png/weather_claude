import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenWeather, normalizeSnow } from '../worker/open-weather.mjs';
import { createForecastAPI } from '../worker/forecast.mjs';

test('Open-Meteo keeps negative temperatures and still drops negative wind', () => {
  const rows = [{ latitude: 57.4, longitude: 21.5, hourly: { time: [1, 2], wind_speed_10m: [-1, 4], temperature_2m: [-3.5, 2] } }];
  const [r] = normalizeOpenWeather(rows, [{ id: '0' }], 'icon_eu');
  assert.deepEqual(r.hourly.temperature_2m, [-3.5, 2]);
  assert.deepEqual(r.hourly.wind_speed_10m, [null, 4]);
});

test('SMHI SNOW air temperature is kept, the 9999 sentinel is dropped', () => {
  const data = { geometry: { coordinates: [21.5, 57.4] }, timeSeries: [
    { time: '2026-10-19T10:00:00Z', intervalParametersStartTime: '2026-10-19T09:00:00Z', data: { wind_speed: 5, air_temperature: -1.2 } },
    { time: '2026-10-19T11:00:00Z', intervalParametersStartTime: '2026-10-19T10:00:00Z', data: { wind_speed: 6, air_temperature: 9999 } } ] };
  assert.deepEqual(normalizeSnow(data, { id: '0' }).hourly.temperature_2m, [-1.2, null]);
});

test('port requests to Open-Meteo ask for 2 m temperature in Celsius', async () => {
  let asked = null;
  const api = createForecastAPI({ now: () => Date.parse('2026-10-19T10:00:00Z'), fetcher: async url => {
    const u = new URL(url);
    if (u.pathname.includes('/static/meta.json')) return Response.json({ last_run_availability_time: 1760860800, last_run_initialisation_time: 1760860800, update_interval_seconds: 10800 });
    asked = u.searchParams;
    const lats = u.searchParams.get('latitude').split(',');
    return Response.json(lats.map(lat => ({ latitude: +lat, longitude: 20, hourly: { time: [1760868000], temperature_2m: [7.5], wind_speed_10m: [5] } })));
  } });
  const res = await api(new Request('https://pogoda.seasync.co/api/forecast?model=icon_eu&group=ports'), {});
  assert.equal(res.status, 200);
  assert(asked.get('hourly').split(',').includes('temperature_2m'));
  assert.equal(asked.get('temperature_unit'), 'celsius');
  assert.equal((await res.json()).records[0].hourly.temperature_2m[0], 7.5);
});

test('map click point forecast: selected model at the clicked position, validated and cached', async () => {
  const { createForecastAPI } = await import('../worker/forecast.mjs');
  const urls = [];
  const api = createForecastAPI({
    now: () => Date.parse('2026-10-20T09:20:00Z'),
    fetcher: async url => {
      urls.push(url); const u = new URL(url);
      return Response.json({ latitude: Number(u.searchParams.get('latitude')), longitude: Number(u.searchParams.get('longitude')), hourly: { time: [1792486800], wind_speed_10m: [7.4], wind_gusts_10m: [11.2], wind_direction_10m: [248] } });
    },
  });
  const r = await api(new Request('https://weather.seasync.co/api/point?model=icon_eu&lat=58.4812&lon=21.3101'), {});
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.record.hourly.wind_speed_10m[0], 7.4);
  assert.equal(d.lat, 58.48); assert.equal(d.lon, 21.32);
  const u = new URL(urls[0]); assert.equal(u.searchParams.get('models'), 'icon_eu'); assert.equal(u.searchParams.get('wind_speed_unit'), 'ms');
  await api(new Request('https://weather.seasync.co/api/point?model=icon_eu&lat=58.481&lon=21.311'), {});
  assert.equal(urls.length, 1, 'nearby clicks share the cached point');
  const dmi = await api(new Request('https://weather.seasync.co/api/point?model=dmi_harmonie&lat=55&lon=15'), {});
  assert.equal(dmi.status, 200); assert.equal(new URL(urls.at(-1)).searchParams.get('models'), 'dmi_harmonie_arome_europe');
  for (const bad of ['model=nope&lat=58&lon=20', 'model=icon_eu&lat=10&lon=20', 'model=icon_eu&lat=58&lon=120'])
    assert.equal((await api(new Request('https://weather.seasync.co/api/point?' + bad), {})).status, 400);
});

test('7-day outlook for the port tiles: one request for all ports, validated and cached', async () => {
  const { createForecastAPI } = await import('../worker/forecast.mjs');
  let calls = 0, seen;
  const api = createForecastAPI({ now: () => Date.parse('2026-10-24T06:00:00Z'), fetcher: async url => {
    calls++; seen = new URL(url);
    const n = seen.searchParams.get('latitude').split(',').length;
    return Response.json(Array.from({ length: n }, () => ({ current: { time: '2026-10-24T08:00', temperature_2m: 9.4, weather_code: 3 }, daily: { time: ['2026-10-24', '2026-10-25'], weather_code: [3, 61], temperature_2m_max: [11.2, 10], temperature_2m_min: [6.1, 7], precipitation_sum: [0, 4.2], precipitation_probability_max: [10, 85], wind_direction_10m_dominant: [250, 300], wind_speed_10m_max: [8, 12], wind_gusts_10m_max: [14, 19] } })));
  } });
  const res = await api(new Request('https://weather.seasync.co/api/daily'), {});
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ports.length, 5);
  assert.equal(data.ports[3].daily.precipitation_probability_max[1], 85);
  assert.equal(data.ports[0].current.temperature_2m, 9.4);
  assert.equal(seen.searchParams.get('forecast_days'), '7');
  assert.equal(seen.searchParams.get('timezone'), 'Europe/Stockholm');
  assert(seen.searchParams.get('daily').includes('wind_direction_10m_dominant'));
  await api(new Request('https://weather.seasync.co/api/daily'), {});
  assert.equal(calls, 1, 'cached');
});
