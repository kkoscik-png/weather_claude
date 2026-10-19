import test from 'node:test';
import assert from 'node:assert/strict';
import { createForecastAPI } from '../worker/forecast.mjs';
import { parseDapAscii, fcooRuns, parseFcooMeta } from '../worker/fcoo.mjs';

const RUN = '2026101906';
const DAS = `Attributes {
    String Last-modified "Mon, 19 Oct 2026 09:02:18 -0000";
    NC_GLOBAL {
        String latitude_resolution "5.0000001E-02";
        String longitude_resolution "8.3333328E-02";
        String southernmost_latitude "48.54167";
        String westernmost_longitude "-4.069440";
    }
    time {
        String units "days since 2026-10-19 05:00:00";
    }
}`;
const DDS = `Dataset {
    Float32 lonc[lonc = 410];
    Float32 latc[latc = 346];
    Float64 time[time = 56];
} x;`;
const LISTING = ['2026101900', RUN].map(r => `<a href="ww3c_NSBALT3NM_${r}.nc.html">ww3c_NSBALT3NM_${r}.nc</a> <a href="ww3c_NSBALT3NM_${r}.nc.das">das</a>`).join('\n');

// Mimics pydap's ASCII Grid response. Row y0 is land; row y0+1 is a merged harbour
// cell (Hs only, sheltered); native 3 NM cells with u/v start at row y0+2.
function ascii(query) {
  let out = 'Dataset {\n} x;\n---------------------------------------------\n';
  for (const part of decodeURIComponent(query).split(',')) {
    const m = part.match(/^(\w+)\[0:1:(\d+)\]\[(\d+):1:(\d+)\]\[(\d+):1:(\d+)\]$/);
    const [, name, t1, y0, y1, x0, x1] = m, T = +t1 + 1, Y = y1 - y0 + 1, X = x1 - x0 + 1;
    out += `${name}.${name}\n`;
    for (let t = 0; t < T; t++) for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
      const value = { u_v: y === 0 ? -9999 : y === 1 ? 0.03 : 0.5 + t / 100, TMN: y === 0 ? -9999 : 4.2, u: y < 2 ? -9999 : -0.3, v: y < 2 ? -9999 : -0.4 }[name];
      out += `[${t}][${y}][${x}] ${value}\n`;
    }
    out += `\n${name}.time\n` + Array.from({ length: T }, (_, t) => `[${t}] ${t / 24}`).join('\n');
    out += `\n\n${name}.latc\n` + Array.from({ length: Y }, (_, y) => `[${y}] ${(48.54167 + (+y0 + y) * 0.05).toFixed(4)}`).join('\n');
    out += `\n\n${name}.lonc\n` + Array.from({ length: X }, (_, x) => `[${x}] ${(-4.06944 + (+x0 + x) * 0.0833333).toFixed(4)}`).join('\n') + '\n\n';
  }
  return out;
}

test('FCOO helpers parse the listing, headers and ASCII grids', () => {
  assert.deepEqual(fcooRuns(LISTING), ['2026101900', RUN]);
  const meta = parseFcooMeta(RUN, DAS, DDS);
  assert.equal(meta.nTime, 56); assert.equal(meta.ny, 346); assert.equal(meta.nx, 410);
  assert.equal(new Date(meta.base).toISOString(), '2026-10-19T05:00:00.000Z');
  assert.equal(meta.updatedAt, '2026-10-19T09:02:18.000Z');
  const data = parseDapAscii(ascii('u_v[0:1:1][177:1:178][307:1:308]'));
  assert.equal(data.u_v.length, 8);
  assert.deepEqual(data.u_v[3].index, [0, 1, 1]);
  assert.equal(data['u_v.time'][1].value, 1 / 24);
  assert.equal(data['u_v.latc'].length, 2);
});

test('FCOO WW3 ports: nearest wet cell, hourly axis and "from" direction', async () => {
  const requests = [];
  const api = createForecastAPI({
    now: () => Date.parse('2026-10-19T11:20:00Z'),
    fetcher: async url => {
      requests.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith('/WW3/')) return new Response(LISTING);
      if (u.pathname.endsWith('.das')) return new Response(DAS);
      if (u.pathname.endsWith('.dds')) return new Response(DDS);
      if (u.pathname.endsWith('.nc.ascii')) { assert(u.pathname.includes(RUN)); return new Response(ascii(u.search.slice(1))); }
      throw Error('unexpected ' + url);
    },
  });
  const response = await api(new Request('https://pogoda.seasync.co/api/forecast?model=fcoo_ww3&group=ports'), {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.records.length, 3);
  const r = data.records[1], h = r.hourly;
  assert.equal(h.time[0], Date.parse('2026-10-19T10:00:00Z') / 1000);
  assert.equal(h.time.length, 73);
  // 10:00 UTC is step 5 of a file starting at 05:00.
  assert.equal(h.wave_height[0], 0.55, 'open-water 3 NM cell, not the sheltered harbour cell');
  assert.equal(h.wave_period[0], 4.2);
  assert.equal(h.wave_direction[0], 37);
  // The file ends 55 h after 05:00 (12:00 on day 3); later hours stay empty.
  assert.equal(h.wave_height.at(-1), null);
  assert.equal(data.timing.referenceTime, '2026-10-19T06:00:00Z');
  assert.equal(data.timing.updatedAt, '2026-10-19T09:02:18.000Z');
  assert(requests.every(u => !u.endsWith('.nc')), 'never downloads the whole file');
  const updates = await api(new Request('https://pogoda.seasync.co/api/model-updates?model=fcoo_ww3'), {});
  assert.equal(updates.status, 200);
});
