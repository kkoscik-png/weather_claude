import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function app() {
  const nodes = new Map(), stored = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', style: {}, setAttribute() {}, classList: { toggle() {} } }); return nodes.get(id); };
  const c = { Intl, Date, Math, Number, Array, Object, String, Map, Set, JSON, console, URLSearchParams, AbortSignal, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) },
    document: { getElementById: el, querySelector: el, querySelectorAll: () => [] } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('dist/app.js', 'utf8').replace(/start\(\);\s*$/, '') + ';globalThis.t={state,PORTS,MODELS,windFlagsSVG,toggleFlagPort,flagPorts,loadFlagPorts,renderPorts,loadSlots,saveSlots,portPicker,ensurePort,isFavourite,searchPorts,setDb:d=>{PORT_DB=d;},dailyFor,BUILTIN_PORTS,favouritePorts};', c);
  const t = c.t, times = [t.state.base];
  t.state.times = times; t.state.hour = 0; t.state.slots = [0, 1, 2];
  t.state.wind = Object.fromEntries(Object.keys(t.MODELS).map(m => [m, t.PORTS.map(() => ({ hourly: { time: times, wind_speed_10m: [7], wind_gusts_10m: [11], wind_direction_10m: [240] } }))]));
  return { t, el, stored };
}
const shown = t => [0, 1, 2].filter(i => t.windFlagsSVG(i).includes('wind-flags-svg'));

test('flags follow the selected point until the user picks points', () => {
  const { t } = app();
  assert.deepEqual(shown(t), [0]);
  t.state.port = 2;
  assert.deepEqual(shown(t), [2]);
});

test('one, two or three points can show flags at the same time', () => {
  const { t, stored } = app();
  t.toggleFlagPort(1);
  assert.deepEqual(shown(t), [0, 1]);
  t.toggleFlagPort(2);
  assert.deepEqual(shown(t), [0, 1, 2]);
  t.toggleFlagPort(0); t.toggleFlagPort(1);
  assert.deepEqual(shown(t), [2]);
  t.toggleFlagPort(2);
  assert.deepEqual(shown(t), []);
  assert.equal(stored.has('baltic-flag-ports'), false);
});

test('cards no longer show port codes and mark the chosen flags', () => {
  const { t, el } = app();
  t.toggleFlagPort(1);
  t.renderPorts();
  const html = el('ports').innerHTML;
  assert(!/LV VNT|SE NYN/.test(html));
  assert.equal((html.match(/data-flag-port=/g) || []).length, 3);
  assert.equal((html.match(/class="port-flag on"/g) || []).length, 2);
});

test('the page opens with ICON-EU, Copernicus Baltic waves, animation, sea state, flags and the remembered ports', () => {
  const src = fs.readFileSync('dist/app.js', 'utf8');
  const opening = src.match(/async function start\(\)\{(?:loadSlots\(\);)?Object\.assign\(state,\{([^}]*)\}\)/)[1];
  assert.match(opening, /model:'icon_eu'/);
  assert.match(opening, /waveSource:'copernicus_baltic'/);
  assert.match(opening, /animate:true/);
  assert.match(opening, /routeWaves:true/);
  assert.match(opening, /flagPorts:new Set\(slotPorts\(\)\.filter\(i=>i!==0\)\)/);
  assert.match(src, /const DEFAULT_SLOTS=\[1,2\];/);
  // The chosen ports and the active tile are remembered per device (first visit: berths 1 and 2).
  assert(/localStorage\.setItem\(PORTS_KEY/.test(src));
  assert.match(opening, /port:openingPort\(\)/);
  assert(!/localStorage\.setItem\('baltic-flag-ports'/.test(src));
  const html = fs.readFileSync('dist/index.html', 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<option value="icon_eu" selected>/);
  assert.match(html, /<option value="copernicus_baltic" selected>/);
  // Order in the left column: two port tiles, Find your port, wind model, wave model.
  assert(html.indexOf('id="ports"') < html.indexOf('id="portSearch"') && html.indexOf('id="portSearch"') < html.indexOf('id="windSource"') && html.indexOf('id="windSource"') < html.indexOf('id="waveSource"'));
  assert.match(html, /Find your port/);
  assert(!/id="info"|id="refresh"/.test(html));
});

test('favourites: four berths by default, tiles list only favourites, added ports keep their place', () => {
  const { t, stored } = app();
  t.loadSlots();
  assert.deepEqual([...t.state.favs], ['ventspils-berth', 'norvik-berth', 'gdynia-berth', 'karlskrona-berth']);
  assert.deepEqual([...t.state.slots], [1, 2]);
  assert.deepEqual([...t.favouritePorts()].map(i => t.PORTS[i].id), ['ventspils-berth', 'norvik-berth', 'gdynia-berth', 'karlskrona-berth']);
  assert.match(t.portPicker(0, 1), /data-port-menu="0"/);
  // A port from the database is appended to PORTS, starred, and survives a reload.
  const i = t.ensurePort({ id: 'db-LTKLJ', name: 'Klaipėda', country: 'LT', lat: 55.71, lon: 21.11, code: 'LTKLJ' });
  assert.equal(i, t.BUILTIN_PORTS);
  assert.equal(t.PORTS[i].country, 'Lithuania');
  t.state.favs.push('db-LTKLJ'); t.state.slots = [1, i]; t.state.port = i; t.saveSlots();
  stored.set('baltic-favourites-v1', JSON.stringify({ ids: [...t.state.favs], info: { 'db-LTKLJ': t.state.portInfo['db-LTKLJ'] } }));
  const again = app();
  for (const [k, v] of stored) again.stored.set(k, v);
  again.t.loadSlots();
  const j = again.t.PORTS.findIndex(p => p.id === 'db-LTKLJ');
  assert(j >= again.t.BUILTIN_PORTS);
  assert.deepEqual([...again.t.state.slots], [1, j]);
  assert.equal(again.t.state.savedPort, j);
  assert(again.t.favouritePorts().includes(j));
});

test('slots saved by older versions (indices) still load', () => {
  const { t, stored } = app();
  stored.set('baltic-ports-v2', JSON.stringify({ slots: [3, 4], port: 4 }));
  t.loadSlots();
  assert.deepEqual([...t.state.slots], [3, 4]);
  assert.equal(t.state.savedPort, 4);
});

test('port search ignores accents and puts berths and main ports first', () => {
  const { t } = app();
  const db = JSON.parse(fs.readFileSync('dist/assets/baltic-ports.json', 'utf8'));
  t.setDb([...t.PORTS.slice(0, 5).map(p => ({ id: p.id, name: p.name, country: p.code.slice(0, 2), lat: p.lat, lon: p.lon, major: true, builtin: true, aliases: [] })), ...db.ports.map(x => ({ ...x, id: 'db-' + x.id, code: x.id }))]);
  const gdan = t.searchPorts('gdan');
  assert(gdan.length && gdan[0].name.startsWith('Gdańsk'), gdan.map(x => x.name).join());
  const gd = t.searchPorts('gdy');
  assert.equal(gd[0].id, 'gdynia-berth');
  assert(t.searchPorts('klaip').some(x => x.name === 'Klaipėda'));
  assert.equal(t.searchPorts('x').length, 0);
  assert(t.searchPorts('a').length === 0 && t.searchPorts('ri').length <= 8);
});

test('picking a found port shows it without starring it; only the star changes favourites', () => {
  const src = fs.readFileSync('dist/app.js', 'utf8');
  const pick = src.match(/function pickFoundPort\(x\)\{[^\n]*/)[0];
  assert(!/state\.favs\s*=/.test(pick), 'choosing a result must not add a favourite');
  assert.match(src, /data-unstar=/);
  assert.match(src, /state\.favs=\(state\.favs\|\|\[\]\)\.filter\(f=>f!==id\)/);
});
