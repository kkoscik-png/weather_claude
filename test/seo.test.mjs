import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHandler, assetCacheControl } from '../worker/index.mjs';

const CANONICAL = 'https://marine.weather.seasync.co/';
const html = fs.readFileSync('dist/index.html', 'utf8');
const meta = (attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];

test('the page names one canonical address and describes itself for search engines', () => {
  assert.match(html, new RegExp(`<link rel="canonical" href="${CANONICAL}">`));
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  for (const port of ['Ventspils', 'Nynäshamn', 'Gdynia', 'Karlskrona']) assert(title.includes(port), port);
  assert(title.length <= 75, `title is ${title.length} characters`);
  const description = meta('name', 'description');
  assert(description.length >= 70 && description.length <= 230, `description is ${description.length} characters`);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, 'exactly one h1');
  assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/);
});

test('shared links get a title, description and a 1200x630 preview image', () => {
  assert.equal(meta('property', 'og:url'), CANONICAL);
  assert.equal(meta('property', 'og:image'), CANONICAL + 'og-image.png');
  assert.equal(meta('property', 'og:image:width'), '1200');
  assert.equal(meta('property', 'og:image:height'), '630');
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
  for (const key of ['og:title', 'og:description', 'og:site_name']) assert(meta('property', key), key);
  const png = fs.readFileSync('dist/og-image.png');
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert(png.length < 600 * 1024, 'preview image stays small');
});

test('structured data is valid JSON and points at the canonical address', () => {
  const json = html.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)[1];
  const data = JSON.parse(json);
  assert.equal(data['@type'], 'WebApplication');
  assert.equal(data.url, CANONICAL);
});

test('robots.txt lets crawlers in, keeps them out of the API and names the sitemap', () => {
  const robots = fs.readFileSync('dist/robots.txt', 'utf8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.doesNotMatch(robots, /^Disallow: \/$/m);
  assert.match(robots, new RegExp(`^Sitemap: ${CANONICAL}sitemap.xml$`, 'm'));
  const sitemap = fs.readFileSync('dist/sitemap.xml', 'utf8');
  assert.match(sitemap, new RegExp(`<loc>${CANONICAL}</loc>`));
});

test('robots.txt and sitemap.xml are served on every public address and revalidated', async () => {
  const handler = createHandler();
  const env = { ASSETS: { async fetch(request) { return new Response(new URL(request.url).pathname); } } };
  for (const host of ['marine.weather.seasync.co', 'weather.seasync.co', 'pogoda.seasync.co']) {
    for (const path of ['/robots.txt', '/sitemap.xml', '/og-image.png']) {
      const response = await handler(new Request(`https://${host}${path}`), env);
      assert.equal(response.status, 200, host + path);
    }
  }
  assert.equal(assetCacheControl(new URL(CANONICAL + 'robots.txt')), 'no-cache');
  assert.equal(assetCacheControl(new URL(CANONICAL + 'sitemap.xml')), 'no-cache');
});
