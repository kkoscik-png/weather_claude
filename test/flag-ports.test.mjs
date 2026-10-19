import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function app() {
  const nodes = new Map(), stored = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', style: {}, setAttribute() {}, classList: { toggle() {} } }); return nodes.get(id); };
  const c = { Intl, Date, Math, Number, Array, Object, String, Map, Set, JSON, console, URLSearchParams, AbortSignal, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) },
    document: { getElementById: el, querySelector: el, querySelectorAll: () => [] } };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('dist/app.js', 'utf8').replace(/start\(\);\s*$/, '') + ';globalThis.t={state,PORTS,MODELS,windFlagsSVG,toggleFlagPort,flagPorts,loadFlagPorts,renderPorts};', c);
  const t = c.t, times = [t.state.base];
  t.state.times = times; t.state.hour = 0;
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
  assert.equal(stored.get('baltic-flag-ports'), '[]');
});

test('the choice is remembered and cards no longer show port codes', () => {
  const { t, el } = app();
  t.toggleFlagPort(1);
  const again = app();
  again.stored.set('baltic-flag-ports', '[1,2]'); again.t.loadFlagPorts();
  assert.deepEqual(shown(again.t), [1, 2]);
  t.renderPorts();
  const html = el('ports').innerHTML;
  assert(!/LV VNT|SE NYN/.test(html));
  assert.equal((html.match(/data-flag-port=/g) || []).length, 3);
  assert.equal((html.match(/class="port-flag on"/g) || []).length, 2);
});
