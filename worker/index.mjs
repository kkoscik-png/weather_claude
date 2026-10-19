import { handleStormglass } from './stormglass.mjs';
import { handleForecast } from './forecast.mjs';

const deny = (message, status) => new Response(message, {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
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
export const ALLOWED_HOSTS = new Set(['pogoda.seasync.co', 'weather.seasync.co']);

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
    if (!ALLOWED_HOSTS.has(url.hostname)) return deny('This address is not allowed.', 403);
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

export default { fetch: createHandler() };
