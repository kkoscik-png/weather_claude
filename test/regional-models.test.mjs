import test from 'node:test';
import assert from 'node:assert/strict';
import { createForecastAPI, normalizeFMI, FMI_HARMONIE } from '../worker/forecast.mjs';

const NOW = Date.parse('2026-10-20T10:20:00Z');
const START = Date.parse('2026-10-20T09:00:00Z') / 1000;

function openMeteo(points) {
  return points.map(p => ({
    latitude: p.lat, longitude: p.lon,
    hourly_units: { wind_speed_10m: 'm/s' },
    hourly: {
      time: Array.from({ length: 97 }, (_, i) => START + i * 3600),
      wind_speed_10m: Array(97).fill(5), wind_gusts_10m: Array(97).fill(8), wind_direction_10m: Array(97).fill(120),
      cloud_cover: Array(97).fill(90), cloud_cover_low: Array(97).fill(null), precipitation: Array(97).fill(0), temperature_2m: Array(97).fill(-1.5),
    },
  }));
}
const meta = () => Response.json({ last_run_availability_time: NOW / 1000 - 1800, last_run_initialisation_time: NOW / 1000 - 7200, update_interval_seconds: 3600 });

test('MET Nordic: one Open-Meteo request for the ports, hourly schedule from meta.json', async () => {
  const seen = [];
  const api = createForecastAPI({ now: () => NOW, fetcher: async url => {
    const u = new URL(url);
    if (u.pathname === '/data/metno_nordic_pp/static/meta.json') return meta();
    seen.push(u);
    const lats = u.searchParams.get('latitude').split(','), lons = u.searchParams.get('longitude').split(',');
    return Response.json(openMeteo(lats.map((lat, i) => ({ lat: +lat, lon: +lons[i] }))));
  } });
  const res = await api(new Request('https://weather.seasync.co/api/forecast?model=metno_nordic&group=ports'), {});
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].searchParams.get('models'), 'metno_nordic');
  assert.equal(data.records.length, 5);
  assert.equal(data.records[0].provider, 'MET Norway via Open-Meteo');
  assert.equal(data.records[0].hourly.temperature_2m[0], -1.5);
  assert.equal(data.records[0].hourly.cloud_cover_low[0], null);
  assert.match(data.attribution, /MET Norway/);
  assert.equal(new Date(data.timing.nextUpdate).getTime() - new Date(data.timing.updatedAt).getTime(), 3600000);
});

test('ICON-D2: ports outside the domain get empty series instead of failing the batch', async () => {
  const seen = [];
  const api = createForecastAPI({ now: () => NOW, fetcher: async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/static/meta.json')) return meta();
    seen.push(u);
    const lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
    if (lats.some((lat, i) => lat > 58.08 || lons[i] > 20.34)) return Response.json({ error: true, reason: 'No data is available for this location' }, { status: 400 });
    return Response.json(openMeteo(lats.map((lat, i) => ({ lat, lon: lons[i] }))));
  } });
  const data = await (await api(new Request('https://weather.seasync.co/api/forecast?model=icon_d2&group=ports'), {})).json();
  assert.equal(data.records.length, 5);
  assert.equal(seen.length, 1, 'only the in-domain ports are requested');
  assert.equal(seen[0].searchParams.get('latitude').split(',').length, 2);
  // Ventspils (x2) and Norvik lie outside ICON-D2; Gdynia and Karlskrona inside.
  assert.deepEqual(data.records.map(r => r.outsideDomain === true), [true, true, true, false, false]);
  assert.equal(data.records[0].hourly.time.length, 97);
  assert(data.records[0].hourly.wind_speed_10m.every(v => v === null));
  assert.equal(data.records[3].hourly.wind_speed_10m[0], 5);
});

test('regional model: an unexpected 400 for the batch falls back to single points', async () => {
  let multi = 0;
  const api = createForecastAPI({ now: () => NOW, fetcher: async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/static/meta.json')) return meta();
    const lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
    if (lats.length > 1) { multi++; return new Response('{"error":true}', { status: 400 }); }
    if (lats[0] > 58) return new Response('{"error":true}', { status: 400 });
    return Response.json(openMeteo([{ lat: lats[0], lon: lons[0] }])[0]);
  } });
  const data = await (await api(new Request('https://weather.seasync.co/api/forecast?model=metno_nordic&group=ports'), {})).json();
  assert.equal(multi, 2, 'batch tried with and without the chance of rain');
  assert.deepEqual(data.records.map(r => Boolean(r.outsideDomain)), [false, false, true, false, false]);
});

function fmiXML(params, lat, lon) {
  const member = (param, values) => `<wfs:member><omso:PointTimeSeriesObservation>
<om:phenomenonTime><gml:TimePeriod><gml:beginPosition>2026-10-20T09:00:00Z</gml:beginPosition></gml:TimePeriod></om:phenomenonTime>
<om:resultTime><gml:TimeInstant><gml:timePosition>2026-10-20T08:12:00Z</gml:timePosition></gml:TimeInstant></om:resultTime>
<om:observedProperty xlink:href="https://opendata.fmi.fi/meta?observableProperty=forecast&amp;param=${param}&amp;language=eng"/>
<sams:shape><gml:Point><gml:pos>${lat.toFixed(5)} ${lon.toFixed(5)} </gml:pos></gml:Point></sams:shape>
<om:result><wml2:MeasurementTimeseries>${values.map((v, i) => `<wml2:point><wml2:MeasurementTVP><wml2:time>${new Date((START + i * 3600) * 1000).toISOString().replace('.000', '')}</wml2:time><wml2:value>${v}</wml2:value></wml2:MeasurementTVP></wml2:point>`).join('')}</wml2:MeasurementTimeseries></om:result>
</omso:PointTimeSeriesObservation></wfs:member>`;
  return `<?xml version="1.0"?><wfs:FeatureCollection>${Object.entries(params).map(([p, v]) => member(p, v)).join('')}</wfs:FeatureCollection>`;
}

test('FMI HARMONIE parser maps weather parameters, keeps negative temperatures and NaN as null', () => {
  const xml = fmiXML({ WindSpeedMS: [3.76, 3.5], WindGust: [6.2, 'NaN'], WindDirection: [95, 101], Temperature: [-2.34, 1], TotalCloudCover: [100, 40], LowCloudCover: [80, 0], Precipitation1h: [0.2, 0] }, 57.3988, 21.5766);
  const r = normalizeFMI(xml, [{ id: '1', lat: 57.398842, lon: 21.576607 }], FMI_HARMONIE);
  const h = r.records[0].hourly;
  assert.deepEqual(h.wind_speed_10m, [3.76, 3.5]);
  assert.deepEqual(h.wind_gusts_10m, [6.2, null]);
  assert.deepEqual(h.temperature_2m, [-2.3, 1]);
  assert.deepEqual(h.cloud_cover_low, [80, 0]);
  assert.deepEqual(h.cloud_cover_mid, [null, null]);
  assert.equal(r.timing.updatedAt, '2026-10-20T08:12:00.000Z');
});

test('FMI HARMONIE: one WFS point query per port, weather fields for ports, wind only for the grid', async () => {
  const seen = [];
  const api = createForecastAPI({ now: () => NOW, fetcher: async url => {
    const u = new URL(url);
    assert.equal(u.hostname, 'opendata.fmi.fi');
    seen.push(u);
    assert.equal(u.searchParams.get('storedquery_id'), 'fmi::forecast::harmonie::surface::point::timevaluepair');
    assert.equal(u.searchParams.get('starttime'), '2026-10-20T09:00:00.000Z');
    const [lat, lon] = u.searchParams.get('latlon').split(',').map(Number);
    const params = Object.fromEntries(u.searchParams.get('parameters').split(',').map(p => [p, [5, 6]]));
    return new Response(fmiXML(params, lat, lon));
  } });
  const ports = await (await api(new Request('https://weather.seasync.co/api/forecast?model=fmi_harmonie&group=ports'), {})).json();
  assert.equal(ports.records.length, 5);
  assert.equal(seen.length, 5);
  assert(seen[0].searchParams.get('parameters').includes('LowCloudCover'));
  assert.equal(ports.records[2].hourly.wind_speed_10m[0], 5);
  assert.match(ports.attribution, /Finnish Meteorological Institute/);
  seen.length = 0;
  const grid = await api(new Request('https://weather.seasync.co/api/forecast?model=fmi_harmonie&group=wind-grid'), {});
  assert.equal(grid.status, 200);
  assert.equal(seen[0].searchParams.get('parameters'), 'WindSpeedMS,WindGust,WindDirection');
  assert.equal((await api(new Request('https://weather.seasync.co/api/forecast?model=fmi_harmonie&group=route'), {})).status, 400);
  const updates = await api(new Request('https://weather.seasync.co/api/model-updates?model=fmi_harmonie'), {});
  assert.equal(updates.status, 200);
});

test('ICON-D2 map field: out-of-domain grid points are filled from icon_seamless, ports are not', async () => {
  const models = [];
  const api = createForecastAPI({ now: () => NOW, fetcher: async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/static/meta.json')) return meta();
    models.push(u.searchParams.get('models'));
    const lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
    return Response.json(openMeteo(lats.map((lat, i) => ({ lat, lon: lons[i] }))));
  } });
  const { FORECAST_GRIDS } = await import('../worker/forecast-points.mjs');
  const outside = FORECAST_GRIDS.windGrid.slice(0, 6).filter(p => p.lat > 58.08 || p.lon > 20.34).length;
  const data = await (await api(new Request('https://weather.seasync.co/api/forecast?model=icon_d2&group=wind-grid'), {})).json();
  assert.equal(data.records.length, 6);
  assert.equal(data.records.filter(r => r.filledFrom === 'icon_seamless').length, outside);
  assert(data.records.every(r => r.hourly.wind_speed_10m[0] === 5));
  if (outside) assert(models.includes('icon_seamless'));
  models.length = 0;
  await api(new Request('https://weather.seasync.co/api/forecast?model=icon_d2&group=ports'), {});
  assert(!models.includes('icon_seamless'));
});

test('custom port positions: group=points serves any Baltic point and is remembered for the pre-fetch', async () => {
  const { parsePoints } = await import('../worker/forecast.mjs');
  assert.equal(parsePoints('54.39512,18.69;55.7,21.12').key, '54.395,18.69;55.7,21.12');
  assert.equal(parsePoints('40,10'), null, 'outside the Baltic');
  assert.equal(parsePoints(Array(7).fill('55,15').join(';')), null, 'at most 6 points');
  const seen = [];
  const api = createForecastAPI({ now: () => NOW, fetcher: async url => {
    const u = new URL(url);
    if (u.pathname.endsWith('/static/meta.json')) return meta();
    seen.push(u);
    const lats = u.searchParams.get('latitude').split(',').map(Number), lons = u.searchParams.get('longitude').split(',').map(Number);
    return Response.json(openMeteo(lats.map((lat, i) => ({ lat, lon: lons[i] }))));
  } });
  const res = await api(new Request('https://marine.weather.seasync.co/api/forecast?model=icon_eu&group=points&pts=54.395,18.69;55.7,21.12'), {});
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.records.length, 2);
  assert.equal(data.group, 'points');
  assert(seen[0].searchParams.get('hourly').includes('cloud_cover_low'), 'port fields (clouds, rain, temperature)');
  assert.equal(seen[0].searchParams.get('latitude'), '54.395,55.7');
  assert.equal((await api(new Request('https://marine.weather.seasync.co/api/forecast?model=icon_eu&group=points&pts=1,1'), {})).status, 400);
});
