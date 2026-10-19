import test from 'node:test';
import assert from 'node:assert/strict';
import { createTTLCache } from '../worker/forecast.mjs';

function store() {
  const entries = new Map();
  return {
    async match(request) { return entries.get(request.url)?.clone(); },
    async put(request, response) { entries.set(request.url, response.clone()); },
  };
}

test('a copy from the shared cache keeps its original age in a new Worker', async () => {
  let clock = 0, loads = 0;
  const shared = store(), load = async () => ({ value: ++loads });
  const first = createTTLCache({ now: () => clock, cache: shared });
  assert.deepEqual(await first('k', 3600, load), { value: 1 });

  clock = 50 * 60000;
  const second = createTTLCache({ now: () => clock, cache: shared });
  assert.deepEqual(await second('k', 3600, load), { value: 1 });
  assert.equal(loads, 1);

  // Ten minutes later the original hour is over, so memory must not keep serving it.
  clock = 60 * 60000;
  assert.deepEqual(await second('k', 3600, load), { value: 2 });
  assert.equal(loads, 2);
});

test('concurrent callers share one download', async () => {
  let loads = 0;
  const cached = createTTLCache({ now: () => 0, cache: store() });
  const load = async () => { loads++; await new Promise(resolve => setTimeout(resolve, 5)); return loads; };
  const results = await Promise.all([cached('k', 60, load), cached('k', 60, load), cached('k', 60, load)]);
  assert.deepEqual(results, [1, 1, 1]);
  assert.equal(loads, 1);
});

test('a failing platform cache never breaks a download', async () => {
  const broken = { async match() { throw Error('unsupported'); }, async put() { throw Error('unsupported'); } };
  const cached = createTTLCache({ now: () => 0, cache: broken });
  assert.equal(await cached('k', 60, async () => 42), 42);
  assert.equal(await cached('k', 60, async () => 43), 42);
});
