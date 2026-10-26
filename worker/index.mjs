import { handleStormglass } from './stormglass.mjs';
import { handleForecast } from './forecast.mjs';
export { ForecastStore } from './store.mjs';

// A visible HTML page, so a refusal from this app is never mistaken for a browser or proxy error.
const deny = (message, status, host = '') => new Response(`<!doctype html><meta charset="utf-8"><title>Baltic · ${status}</title><body style="font:15px system-ui;padding:40px;color:#14323c"><h1 style="font-size:18px">Baltic Wind &amp; Waves · ${status}</h1><p>${message}</p>${host ? `<p style="color:#7b8b92">Host: ${host.replace(/[^a-z0-9.-]/gi, '')}</p>` : ''}<p><a href="https://pogoda.seasync.co/">pogoda.seasync.co</a></p></body>`, {
  status,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
});

// The page only talks to its own API; map tiles and fonts are the only third parties.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Public addresses of this app. Everything else (workers.dev, previews) is refused.
// Both public addresses serve the app; www. variants redirect to them.
export const ALLOWED_HOSTS = new Set(['marine.weather.seasync.co', 'weather.seasync.co', 'pogoda.seasync.co']);
// "www." variants and the old pogoda.seasync.co address only redirect to the canonical one.
// marine.weather.seasync.co, weather.seasync.co and pogoda.seasync.co all serve the app; www. variants redirect.
export const REDIRECT_HOSTS = new Map([['www.weather.seasync.co', 'weather.seasync.co'], ['www.pogoda.seasync.co', 'pogoda.seasync.co']]);

const YEAR = 31536000, DAY = 86400;

// Versioned files (?v=…) never change, so browsers keep them for a year.
// HTML is always revalidated, so a new deployment is picked up immediately.
export function assetCacheControl(url) {
  const path = url.pathname;
  if (path === '/' || path.endsWith('.html') || !/\.[a-z0-9]+$/i.test(path)) return 'no-cache';
  if (url.searchParams.has('v')) return `public, max-age=${YEAR}, immutable`;
  if (path.startsWith('/assets/')) return `public, max-age=${7 * DAY}, stale-while-revalidate=${DAY}`;
  if (/\.(png|svg|webmanifest|ico)$/i.test(path)) return `public, max-age=${DAY}, stale-while-revalidate=${7 * DAY}`;
  return 'no-cache';
}

export function createHandler() {
  return async function fetch(request, env, ctx) {
    // The owner selected public access without a PIN or login.
    const url = new URL(request.url);
    const canonical = REDIRECT_HOSTS.get(url.hostname) || (ALLOWED_HOSTS.has(url.hostname) ? url.hostname : null);
    if (!canonical) return deny('This address is not allowed.', 403, url.hostname);
    // Always serve the canonical host over HTTPS (typed "www." or "http://" addresses land here).
    if (canonical !== url.hostname || url.protocol === 'http:') {
      const target = new URL(url); target.protocol = 'https:'; target.hostname = canonical; target.port = '';
      return new Response(null, { status: 301, headers: { Location: target.href, 'Cache-Control': 'public, max-age=3600' } });
    }
    if (!env.ASSETS?.fetch) return deny('The app is waiting for the deployment to finish.', 503);
    const api = await handleStormglass(request, env, ctx);
    if (api) return api;
    const forecast = await handleForecast(request, env, ctx);
    if (forecast) return forecast;
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    if (asset.ok || asset.status === 304) response.headers.set('Cache-Control', assetCacheControl(url));
    else response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
    return response;
  };
}

// Every 5 minutes: fetch whatever forecast cycle has become due into the shared store, so
// visitors get every source and point group straight from the server. Each entry runs as a
// separate invocation of this Worker when the runtime offers it (ctx.exports), otherwise in-process.
export function createScheduled(fetchHandler) {
  return async function scheduled(event, env, ctx) {
    const self = ctx?.exports?.default;
    const call = self?.fetch ? request => self.fetch(request) : request => fetchHandler(request, env, ctx);
    const result = await handleForecast.prewarm(env, call, self?.fetch ? { mode: 'exports' } : { limit: 8, concurrency: 2, mode: 'in-process' });
    console.log('prewarm', JSON.stringify(result));
  };
}

const fetchHandler = createHandler();
export default { fetch: fetchHandler, scheduled: createScheduled(fetchHandler) };
