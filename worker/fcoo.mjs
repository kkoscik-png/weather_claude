// FCOO (Danish Defence Centre for Operational Oceanography) WAVEWATCH III,
// North Sea–Baltic 3 NM grid, read through FCOO's public OPeNDAP server.
// Only small hyperslabs around each point are requested, never the 128 MB file.
const HOUR = 3600000;
export const FCOO_BASE = 'https://data.fcoo.dk/webmap/v2/data/NETCDF/FCOO/WW3/';
const PREFIX = 'ww3c_NSBALT3NM_';
const FILL = -9999;

export function fcooRuns(listing) {
  return [...new Set([...String(listing).matchAll(/ww3c_NSBALT3NM_(\d{10})\.nc(?![.\w])/g)].map(m => m[1]))].sort();
}
const runISO = run => `${run.slice(0, 4)}-${run.slice(4, 6)}-${run.slice(6, 8)}T${run.slice(8, 10)}:00:00Z`;

// Run metadata from the DAS/DDS headers: time origin, number of steps, grid.
export function parseFcooMeta(run, das, dds) {
  const units = das.match(/time\s*\{[\s\S]*?String units "days since ([0-9-]+ [0-9:]+)"/)?.[1];
  const base = Date.parse(units?.replace(' ', 'T') + 'Z');
  const size = name => Number(dds.match(new RegExp('Float\\d+ ' + name + '\\[' + name + ' = (\\d+)\\]'))?.[1]);
  const attr = name => Number(das.match(new RegExp('String ' + name + ' "([-0-9.E+]+)"'))?.[1]);
  const modified = das.match(/String Last-modified "([^"]+)"/)?.[1];
  const meta = {
    run, file: FCOO_BASE + PREFIX + run + '.nc', base, nTime: size('time'), ny: size('latc'), nx: size('lonc'),
    lat0: attr('southernmost_latitude'), lon0: attr('westernmost_longitude'),
    dlat: attr('latitude_resolution'), dlon: attr('longitude_resolution'),
    referenceTime: runISO(run), updatedAt: Number.isFinite(Date.parse(modified)) ? new Date(Date.parse(modified)).toISOString() : null,
  };
  if (![meta.base, meta.nTime, meta.ny, meta.nx, meta.lat0, meta.lon0, meta.dlat, meta.dlon].every(Number.isFinite)) throw Error('Unsupported FCOO file header');
  return meta;
}

export function fcooTiming(meta) {
  // A run is published about 3 h after its nominal time; the next one follows 6 h later.
  const reference = Date.parse(meta.referenceTime);
  return { updatedAt: meta.updatedAt || meta.referenceTime, referenceTime: meta.referenceTime, nextUpdate: new Date(reference + 6 * HOUR + 190 * 60000).toISOString(), basis: 'reference', estimated: true };
}

// DAP2 ASCII: "var.var" followed by "[t][y][x] value" lines; maps follow as "var.time" etc.
export function parseDapAscii(text) {
  const out = {}; let current = null;
  for (const line of String(text).split('\n')) {
    const head = line.match(/^(\w+)\.(\w+)\s*$/);
    if (head) { current = head[1] === head[2] ? head[1] : head[1] + '.' + head[2]; out[current] = []; continue; }
    const row = current && line.match(/^((?:\[\d+\])+)\s+(\S+)/);
    if (row) out[current].push({ index: row[1].slice(1, -1).split('][').map(Number), value: Number(row[2]) });
  }
  return out;
}

const valid = v => Number.isFinite(v) && v !== FILL && v > -9000;

// Pick the nearest cell in the requested window that passes the test.
function nearestCell(window, test, point) {
  let best = null, dist = Infinity;
  for (let y = 0; y < window.ny; y++) for (let x = 0; x < window.nx; x++) {
    if (!test(y, x)) continue;
    const dy = window.lats[y] - point.lat, dx = (window.lons[x] - point.lon) * Math.cos(point.lat * Math.PI / 180), d = dx * dx + dy * dy;
    if (d < dist) { dist = d; best = { y, x }; }
  }
  return best;
}

export function fcooRecord(point, meta, data, window, times) {
  const grid = name => { const a = new Map(); for (const { index, value } of data[name] || []) a.set(index.join(','), value); return a; };
  const hs = grid('u_v'), u = grid('u'), v = grid('v'), tm = grid('TMN');
  const timeOf = (data['u_v.time'] || []).map(r => Math.round((meta.base + r.value * 86400000) / HOUR) * 3600);
  const at = (map, k, c) => map.get([k, c.y, c.x].join(','));
  const first = timeOf.length ? 0 : null;
  // Prefer native 3 NM cells (u/v defined): open-water values like the other models.
  // The merged 600 m harbour cells only carry Hs and report sheltered basins.
  const cellD = first == null ? null : nearestCell(window, (y, x) => valid(at(u, 0, { y, x })) && valid(at(v, 0, { y, x })) && valid(at(hs, 0, { y, x })), point);
  const cellH = cellD || (first == null ? null : nearestCell(window, (y, x) => valid(at(hs, 0, { y, x })) && at(hs, 0, { y, x }) >= 0, point));
  const index = new Map(timeOf.map((t, k) => [t, k]));
  const record = {
    id: point.id, latitude: cellH ? window.lats[cellH.y] : point.lat, longitude: cellH ? window.lons[cellH.x] : point.lon,
    provider: 'FCOO', model: 'WW3 NSB 3 NM',
    hourly: { time: times, wave_height: [], wave_direction: [], wave_period: [] },
  };
  for (const t of times) {
    const k = index.get(t);
    const h = k != null && cellH ? at(hs, k, cellH) : null, p = k != null && cellH ? at(tm, k, cellH) : null;
    const uu = k != null && cellD ? at(u, k, cellD) : null, vv = k != null && cellD ? at(v, k, cellD) : null;
    record.hourly.wave_height.push(valid(h) && h >= 0 ? Math.round(h * 100) / 100 : null);
    record.hourly.wave_period.push(valid(p) && p > 0 ? Math.round(p * 10) / 10 : null);
    // u/v point where the waves travel; the app shows the "from" direction.
    record.hourly.wave_direction.push(valid(uu) && valid(vv) && (uu || vv) ? Math.round(((Math.atan2(uu, vv) * 180 / Math.PI) + 540) % 360) : null);
  }
  return record;
}

export async function fcooMeta({ getText, cached }) {
  const runs = fcooRuns(await getText(FCOO_BASE, 600));
  if (!runs.length) throw Error('No FCOO WW3 run listed');
  let lastError;
  // The newest file can still be in transfer; fall back to the previous run.
  for (const run of runs.slice(-2).reverse()) {
    try {
      return await cached('fcoo-meta/' + run, 6 * 3600, async () => {
        const file = FCOO_BASE + PREFIX + run + '.nc';
        const [das, dds] = await Promise.all([getText(file + '.das', 0), getText(file + '.dds', 0)]);
        return parseFcooMeta(run, das, dds);
      });
    } catch (e) { lastError = e; }
  }
  throw lastError;
}

export async function loadFcoo(points, group, { getText, cached, now }) {
  const meta = await fcooMeta({ getText, cached });
  const start = Math.floor(now / HOUR) * HOUR - HOUR, times = Array.from({ length: 73 }, (_, i) => start / 1000 + i * 3600);
  // Harbour and coastal points can sit on land cells; search a wider window there.
  const radius = group === 'ports' || group === 'coast' ? 3 : 1, last = meta.nTime - 1;
  const one = async p => {
    const j = Math.round((p.lat - meta.lat0) / meta.dlat), i = Math.round((p.lon - meta.lon0) / meta.dlon);
    if (j < 0 || i < 0 || j >= meta.ny || i >= meta.nx) throw Error('Point outside the FCOO grid');
    const y0 = Math.max(0, j - radius), y1 = Math.min(meta.ny - 1, j + radius), x0 = Math.max(0, i - radius), x1 = Math.min(meta.nx - 1, i + radius);
    const slab = `[0:1:${last}][${y0}:1:${y1}][${x0}:1:${x1}]`;
    const url = meta.file + '.ascii?' + ['u_v', 'u', 'v', 'TMN'].map(n => n + slab).join(',');
    const data = await cached('fcoo-point/' + meta.run + '/' + y0 + '-' + x0 + '-' + radius, 6 * 3600, async () => parseDapAscii(await getText(url, 0)));
    const window = { ny: y1 - y0 + 1, nx: x1 - x0 + 1, lats: Array.from({ length: y1 - y0 + 1 }, (_, k) => meta.lat0 + (y0 + k) * meta.dlat), lons: Array.from({ length: x1 - x0 + 1 }, (_, k) => meta.lon0 + (x0 + k) * meta.dlon) };
    const lats = (data['u_v.latc'] || []).map(r => r.value), lons = (data['u_v.lonc'] || []).map(r => r.value);
    if (lats.length === window.ny) window.lats = lats;
    if (lons.length === window.nx) window.lons = lons;
    return fcooRecord(p, meta, data, window, times);
  };
  const records = [];
  for (let k = 0; k < points.length; k += 3) records.push(...await Promise.all(points.slice(k, k + 3).map(one)));
  if (!records.some(r => r.hourly.wave_height.some(v => v != null))) throw Error('No FCOO wave data');
  return { records, timing: fcooTiming(meta), saved: now, delivery: 'fcoo', attribution: 'FCOO – Danish Defence Centre for Operational Oceanography, WAVEWATCH III' };
}
