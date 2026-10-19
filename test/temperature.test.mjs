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
