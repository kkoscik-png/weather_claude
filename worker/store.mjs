// Global forecast store: one SQLite-backed Durable Object shared by every Cloudflare location.
// The Cache API (caches.default) is per data centre; this store makes a forecast downloaded
// anywhere (or by the scheduled pre-fetch) available to every visitor at once.
// Values are kept as JSON text; "m:<key>" holds the time after which the value is due again.
const CHUNK = 128; // storage.get() accepts at most 128 keys at a time

export class ForecastStore {
  constructor(ctx) { this.storage = ctx.storage; }

  async fetch(request) {
    const url = new URL(request.url), key = url.searchParams.get('key');
    if (url.pathname === '/get' && key) {
      const value = await this.storage.get('v:' + key);
      return value === undefined ? new Response(null, { status: 404 }) : new Response(value, { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/put' && key && request.method === 'PUT') {
      const body = await request.text(), after = Number(url.searchParams.get('after')) || 0;
      await this.storage.put({ ['v:' + key]: body, ['m:' + key]: after });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/due' && request.method === 'POST') {
      const { keys = [], now = Date.now() } = await request.json();
      const due = [];
      for (let i = 0; i < keys.length; i += CHUNK) {
        const part = keys.slice(i, i + CHUNK), metas = await this.storage.get(part.map(k => 'm:' + k));
        for (const k of part) if (!(Number(metas.get('m:' + k)) > now)) due.push(k);
      }
      return Response.json(due);
    }
    return new Response('Not found', { status: 404 });
  }
}

// Worker-side client for the store; null when the binding is missing (tests, local runs).
export function remoteStore(env, name = 'forecasts-v1') {
  const ns = env?.FORECAST_STORE;
  if (!ns?.idFromName || !ns.get) return null;
  const stub = ns.get(ns.idFromName(name)), base = 'https://forecast-store';
  return {
    async get(key) {
      const r = await stub.fetch(base + '/get?key=' + encodeURIComponent(key));
      return r.status === 200 ? r.json() : null;
    },
    async put(key, value, after = 0) {
      const r = await stub.fetch(base + '/put?key=' + encodeURIComponent(key) + '&after=' + Math.round(after), { method: 'PUT', body: JSON.stringify(value) });
      await r.body?.cancel?.();
    },
    async due(keys, now) {
      const r = await stub.fetch(base + '/due', { method: 'POST', body: JSON.stringify({ keys, now }) });
      return r.ok ? r.json() : keys;
    },
  };
}
