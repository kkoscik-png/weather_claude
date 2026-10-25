import { bloscReader } from './blosc.mjs';
const PRODUCT = 'BALTICSEA_ANALYSISFORECAST_WAV_003_010';
const ROOT = 'https://stac.marine.copernicus.eu/metadata/' + PRODUCT + '/';
const FIELDS = { VHM0: 'wave_height', VMDR: 'wave_direction', VTPK: 'wave_period' };
export async function copernicusDataset(getJSON, now) {
  const catalog = await getJSON(ROOT + 'product.stac.json', 1800);
  const items = catalog.links.filter(l => l.rel === 'item' && /cmems_mod_bal_wav_anfc_PT1H-i_\d+\/dataset/.test(l.href));
  const versions = await Promise.all(items.map(l => getJSON(new URL(l.href, ROOT).href, 1800)));
  const active = versions.filter(d => Date.parse(d.properties?.admp_released_date || '2000-01-01') <= now && Date.parse(d.properties?.admp_retired_date || '2100-01-01') > now);
  active.sort((a,b) => Date.parse(b.properties.admp_released_date) - Date.parse(a.properties.admp_released_date));
  const dataset = active[0]; if (!dataset?.assets?.geoChunked) throw Error('No active Copernicus dataset');
  return dataset;
}
export async function loadCopernicus(points, { getJSON, getBuffer, now }) {
  const dataset = await copernicusDataset(getJSON, now), asset = dataset.assets.geoChunked, root = asset.href + '/';
  const meta = (await getJSON(root + '.zmetadata', 1800)).metadata, dims = asset.viewDims;
  const axes = {};
  for (const axis of ['latitude', 'longitude']) {
    const a = meta[axis + '/.zarray'], reader = bloscReader(await getBuffer(root + axis + '/0', 86400));
    axes[axis] = Array.from({length:a.shape[0]}, (_,i) => reader.number(i));
  }
  const start = Math.floor(now / 3600000) * 3600000 - 3600000, times = Array.from({length:73}, (_,i) => start / 1000 + i * 3600);
  const t0 = Math.round((start - dims.time.coords.min) / 3600000);
  const nearest = (values, x) => values.reduce((best,v,i) => Math.abs(v-x) < Math.abs(values[best]-x) ? i : best, 0);
  const locations = points.map(p => ({...p, x:nearest(axes.longitude,p.lon), y:nearest(axes.latitude,p.lat)}));
  const records = locations.map(p => ({id:p.id,latitude:axes.latitude[p.y],longitude:axes.longitude[p.x],provider:'Copernicus Marine / FMI',model:'Baltic WAM',hourly:{time:times, wave_height:times.map(()=>null),wave_direction:times.map(()=>null),wave_period:times.map(()=>null)}}));
  for (const [field,key] of Object.entries(FIELDS)) {
    const array = meta[field + '/.zarray'];
    if (!array || array.dtype !== '<f4' || array.order !== 'C' || array.compressor?.id !== 'blosc' || array.compressor.cname !== 'lz4' || array.filters?.length) throw Error('Unsupported Copernicus format');
    const [ct,cy,cx] = array.chunks, groups = new Map();
    locations.forEach((p,i) => times.forEach((_,j) => {
      const t = t0+j; if (t < 0 || t >= array.shape[0]) return;
      const chunk = [Math.floor(t/ct),Math.floor(p.y/cy),Math.floor(p.x/cx)].join('.');
      if (!groups.has(chunk)) groups.set(chunk, []); groups.get(chunk).push({i,j,index:(t%ct)*cy*cx+(p.y%cy)*cx+(p.x%cx)});
    }));
    const chunks=[...groups];
    for(let batch=0;batch<chunks.length;batch+=3)await Promise.all(chunks.slice(batch,batch+3).map(async ([chunk,targets]) => {
      const reader = bloscReader(await getBuffer(root + field + '/' + chunk, 0));
      for (const t of targets) {
        const loc=locations[t.i];
        // Reuse one nearby wet cell for height, direction and period. Never
        // combine parameters sampled from different cells or providers.
        if(field==='VHM0'&&t.j===0&&(!Number.isFinite(reader.number(t.index))||reader.number(t.index)===array.fill_value)){
          let best=Infinity,selected=null;const ox=loc.x%cx,oy=loc.y%cy,base=t.index-oy*cx-ox;
          for(let yy=Math.max(0,oy-6);yy<=Math.min(cy-1,oy+6);yy++)for(let xx=Math.max(0,ox-6);xx<=Math.min(cx-1,ox+6);xx++){
            const value=reader.number(base+yy*cx+xx),dist=(yy-oy)**2+(xx-ox)**2;
            if(Number.isFinite(value)&&value>=0&&value!==array.fill_value&&dist<best){best=dist;selected={dx:xx-ox,dy:yy-oy};}
          }
          if(selected){loc.dx=selected.dx;loc.dy=selected.dy;records[t.i].latitude=axes.latitude[loc.y+loc.dy];records[t.i].longitude=axes.longitude[loc.x+loc.dx];}
        }
        const v = reader.number(t.index+(loc.dy||0)*cx+(loc.dx||0)); records[t.i].hourly[key][t.j] = Number.isFinite(v) && v !== array.fill_value && v >= 0 && (key !== 'wave_direction' || v <= 360) ? v : null;
      }
    }));
  }
  const updatedAt = dataset.properties.admp_updated_data || dataset.properties.admp_updated;
  return {records, timing:{updatedAt, referenceTime:null, nextUpdate:new Date(Date.parse(updatedAt)+12*3600000).toISOString(),basis:'publication',estimated:true}, attribution:'Copernicus Marine Service, '+PRODUCT+'; FMI; DOI 10.48670/moi-00011'};
}

// Whole-Baltic wave map: the full-domain (time-chunked) store gives every sea cell for two
// hours per ~1 MB chunk, so a map of hundreds of points costs one chunk per two hours.
const gridCells = new Map();
export async function loadCopernicusGrid(points, times, { getJSON, getBuffer, now }) {
  const dataset = await copernicusDataset(getJSON, now), asset = dataset.assets.timeChunked;
  if (!asset) throw Error('No Copernicus map store');
  const root = asset.href + '/', meta = (await getJSON(root + '.zmetadata', 1800)).metadata, t0ms = asset.viewDims.time.coords.min;
  if (!gridCells.has(root)) {
    const axes = {};
    for (const axis of ['latitude', 'longitude']) {
      const a = meta[axis + '/.zarray'], reader = bloscReader(await getBuffer(root + axis + '/0'));
      axes[axis] = Array.from({ length: a.shape[0] }, (_, i) => reader.number(i));
    }
    gridCells.clear(); gridCells.set(root, axes);
  }
  const axes = gridCells.get(root), ny = axes.latitude.length, nx = axes.longitude.length;
  const nearest = (values, x) => { let b = 0; for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - x) < Math.abs(values[b] - x)) b = i; return b; };
  const cells = points.map(p => ({ y: nearest(axes.latitude, p.lat), x: nearest(axes.longitude, p.lon) }));
  const out = { hs: points.map(() => times.map(() => null)), dir: points.map(() => times.map(() => null)) };
  for (const [field, key] of [['VHM0', 'hs'], ['VMDR', 'dir']]) {
    const array = meta[field + '/.zarray'];
    if (!array || array.dtype !== '<f4' || array.order !== 'C' || array.compressor?.id !== 'blosc' || array.compressor.cname !== 'lz4' || array.filters?.length || array.chunks[1] !== ny || array.chunks[2] !== nx) throw Error('Unsupported Copernicus map format');
    const ct = array.chunks[0], plane = ny * nx, groups = new Map();
    times.forEach((t, j) => { const k = Math.round((t * 1000 - t0ms) / 3600000); if (k < 0 || k >= array.shape[0]) return; const c = Math.floor(k / ct); if (!groups.has(c)) groups.set(c, []); groups.get(c).push({ j, local: k % ct }); });
    const list = [...groups];
    for (let b = 0; b < list.length; b += 3) await Promise.all(list.slice(b, b + 3).map(async ([c, targets]) => {
      const reader = bloscReader(await getBuffer(root + field + '/' + c + '.0.0'));
      const ok = v => Number.isFinite(v) && v !== array.fill_value && v >= 0 && (key !== 'dir' || v <= 360);
      for (const { j, local } of targets) cells.forEach((cell, i) => {
        // A grid point next to the coast may fall on a land cell: use the nearest wet cell (≤ 4 cells).
        if (key === 'hs' && !cell.checked) {
          cell.checked = true;
          if (!ok(reader.number(local * plane + cell.y * nx + cell.x))) {
            let best = null, dist = Infinity;
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
              const y = cell.y + dy, x = cell.x + dx; if (y < 0 || x < 0 || y >= ny || x >= nx) continue;
              const d = dy * dy + dx * dx; if (d < dist && ok(reader.number(local * plane + y * nx + x))) { dist = d; best = { y, x }; }
            }
            if (best) Object.assign(cell, best); else cell.dry = true;
          }
        }
        if (cell.dry) return;
        const v = reader.number(local * plane + cell.y * nx + cell.x);
        out[key][i][j] = ok(v) ? (key === 'hs' ? Math.round(v * 100) / 100 : Math.round(v)) : null;
      });
    }));
  }
  const updatedAt = dataset.properties.admp_updated_data || dataset.properties.admp_updated;
  return { ...out, timing: { updatedAt, referenceTime: null, nextUpdate: new Date(Date.parse(updatedAt) + 12 * 3600000).toISOString(), basis: 'publication', estimated: true }, attribution: 'Copernicus Marine Service, ' + PRODUCT + '; FMI; DOI 10.48670/moi-00011' };
}
