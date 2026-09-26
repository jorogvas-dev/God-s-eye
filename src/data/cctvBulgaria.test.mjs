import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBulgariaSourcesFromCatalog } from '../../server/providers/cctv/sources.js';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';
import { cctvProxy } from '../../server/providers/cctv.js';
import { fetchBulgariaSnapshot } from '../../server/providers/cctv/media.js';
import { BULGARIA_STALE_FRAME_MS } from '../../server/providers/cctv/constants.js';
import { createCctvSource } from '../layers/cctv/source.js';
import { DATA_CREDITS } from './dataCredits.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(root, 'config/cctv_sources.bulgaria.json'), 'utf8'));
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]);
const imageResponse = (modified = new Date().toUTCString()) => new Response(jpeg, {
  headers: { 'content-type': 'image/jpeg', ...(modified ? { 'last-modified': modified } : {}) },
});

function cleanEnvironment(t, overrides = {}) {
  const before = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('CCTV_') || key.startsWith('GOOGLE_MAPS_')) delete process.env[key];
  }
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in before)) delete process.env[key];
    }
    Object.assign(process.env, before);
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
}

function temporaryCatalog(t, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gev-bulgaria-'));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config/cctv_sources.bulgaria.json'), JSON.stringify(rows));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('all 15 official Bulgarian camera locations have unique identities and approved JPEG paths', () => {
  const cameras = loadBulgariaSourcesFromCatalog({ sourceRoot: root });
  assert.equal(cameras.length, 15);
  assert.equal(new Set(cameras.map(c => c.id)).size, 15);
  for (const camera of cameras) {
    assert.ok(camera.lat >= 41 && camera.lat <= 44.3);
    assert.ok(camera.lon >= 22.3 && camera.lon <= 28.7);
    assert.equal(new URL(camera.url).origin, 'https://cdn.uab.org');
    assert.equal(camera.snapshotUrl, camera.url);
    assert.equal(camera.feedType, 'image');
    assert.equal(camera.headingConfidence, 'low');
    assert.equal(camera.poseSource, undefined, 'official coordinates do not establish a surveyed pose');
    assert.match(camera.credit, /Съюз на българските автомобилисти.*https:\/\/www.sba.bg\/cctv/);
  }
  const petrohan = cameras.find(c => c.id === 'bulgaria-sba-115');
  assert.equal(petrohan.name, 'Петрохан');
  assert.deepEqual([petrohan.lat, petrohan.lon], [43.121385, 23.124707]);
  const kulata = cameras.filter(c => ['bulgaria-sba-01', 'bulgaria-sba-02'].includes(c.id));
  assert.equal(kulata.length, 2, 'co-located views are separate cameras');
  assert.deepEqual(kulata.map(c => [c.lat, c.lon]), [[41.3829516, 23.3624983], [41.3829516, 23.3624983]]);
  assert.ok(DATA_CREDITS.some(c => c.key === 'bulgaria-sba-cctv' && c.html.includes('https://www.sba.bg/cctv')));
});

test('the loader rejects invalid coordinates, mismatched IDs, URL tricks and malformed rows', t => {
  const row = registry[0];
  const rows = [null, [], 'invalid', { ...row, id: {} }, { ...row, name: null },
    ...[null, '', '41.38', NaN, 0, 90, 40.9].map(lat => ({ ...row, lat })),
    ...[null, '23.36', 0, 180].map(lon => ({ ...row, lon })),
    ...[
      'http://cdn.uab.org/images/cctv/images/cctv/cctv_01/cctv.jpg',
      'https://cdn.uab.org.evil.test/images/cctv/images/cctv/cctv_01/cctv.jpg',
      'https://cdn.uab.org@127.0.0.1/cctv.jpg',
      'https://cdn.uab.org:8443/images/cctv/images/cctv/cctv_01/cctv.jpg',
      'https://cdn.uab.org/images/cctv/images/cctv/cctv_02/cctv.jpg',
      `${row.url}?url=http://127.0.0.1`,
      'file:///etc/passwd',
    ].map(url => ({ ...row, url })),
    row, row,
  ];
  const cameras = loadBulgariaSourcesFromCatalog({ sourceRoot: temporaryCatalog(t, rows) });
  assert.deepEqual(cameras.map(c => c.id), [row.id]);
});

test('a missing, broken or non-array registry isolates failure to the Bulgaria pack', t => {
  assert.deepEqual(loadBulgariaSourcesFromCatalog({ sourceRoot: path.join(root, 'missing-sba-catalog') }), []);
  const sourceRoot = temporaryCatalog(t, {});
  assert.deepEqual(loadBulgariaSourcesFromCatalog({ sourceRoot }), []);
  fs.writeFileSync(path.join(sourceRoot, 'config/cctv_sources.bulgaria.json'), '{');
  assert.deepEqual(loadBulgariaSourcesFromCatalog({ sourceRoot }), []);
});

function mockCatalogFetch(t, respond = () => imageResponse()) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const href = String(url);
    requests.push({ url: href, init });
    if (href.startsWith('https://cdn.uab.org/')) return respond(href, init);
    // Dynamic packs contribute nothing; shipped local packs still exercise
    // the production registry merge without live external requests.
    return Response.json([]);
  });
  return requests;
}

test('the shared catalog includes Bulgaria, preserves region/provider fields and existing packs, without polling frames', async t => {
  cleanEnvironment(t);
  const requests = mockCatalogFetch(t);
  const catalog = createCctvCatalog({ sourceRoot: root });
  const sources = await catalog();
  const bulgaria = sources.filter(c => c.cityId === 'bulgaria');
  assert.equal(bulgaria.length, 15);
  assert.equal(sources.filter(c => c.provider === 'SBA / Union of Bulgarian Motorists').length, 15);
  assert.ok(bulgaria.every(c => c.city === 'Bulgaria' && c.sourceKind === 'bulgaria-sba'));
  assert.ok(sources.some(c => c.id === 'warendorf-marktplatz-rathaus'));
  assert.ok(sources.some(c => c.cityId === 'tallinn'));
  assert.equal(requests.some(r => r.url.includes('cdn.uab.org')), false);
  const count = requests.length;
  await catalog();
  assert.equal(requests.length, count, 'metadata caching avoids extra provider requests');
});

test('Bulgaria kill switch removes only its own pack', async t => {
  cleanEnvironment(t, { CCTV_BULGARIA_ENABLED: '0' });
  mockCatalogFetch(t);
  const sources = await createCctvCatalog({ sourceRoot: root })();
  assert.equal(sources.some(c => c.cityId === 'bulgaria'), false);
  assert.ok(sources.some(c => c.id === 'warendorf-marktplatz-rathaus'));
});

test('Bulgaria participates in the existing fair catalog cap', async t => {
  cleanEnvironment(t, { CCTV_MAX_SOURCES: '100' });
  mockCatalogFetch(t);
  const sources = await createCctvCatalog({ sourceRoot: root })();
  assert.ok(sources.length <= 100);
  assert.ok(sources.some(c => c.cityId === 'bulgaria'));
  assert.ok(sources.some(c => c.cityId === 'tallinn'));
});

function mount(t, respond) {
  cleanEnvironment(t);
  const requests = mockCatalogFetch(t, respond);
  let handler;
  cctvProxy({ sourceRoot: root }).configureServer({
    middlewares: { use: (_route, callback) => { handler = callback; } },
  });
  return {
    requests,
    async call(url) {
      const response = { status: 0, headers: {}, body: null,
        writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
        end(body) { this.body = body; },
      };
      await handler({ url, method: 'GET', headers: {} }, response);
      return response;
    },
  };
}

test('Bulgarian camera IDs resolve through the existing proxy, ignoring client-supplied upstreams', async t => {
  const app = mount(t);
  const catalog = JSON.parse((await app.call('/sources')).body).sources;
  const camera = catalog.find(c => c.id === 'bulgaria-sba-02');
  assert.equal(camera.name, 'ГКПП Кулата - посока София');
  assert.equal(camera.city, 'Bulgaria');
  assert.match(camera.credit, /SBA/);
  assert.equal(camera.url, undefined, 'the catalog does not hand third-party URLs to browsers');
  const client = createCctvSource();
  const clientUrl = new URL(client.getFrameUrl(camera), 'http://localhost');
  assert.equal(clientUrl.pathname, '/api/cctv/frame/bulgaria-sba-02');
  const frame = await app.call(`${clientUrl.pathname}?upstream=http://127.0.0.1/private&url=https://evil.test/a.jpg`);
  assert.equal(frame.status, 200);
  assert.equal(frame.headers['Content-Type'], 'image/jpeg');
  assert.equal(frame.headers['Cache-Control'], 'no-store');
  assert.deepEqual(frame.body, jpeg);
  const upstreams = app.requests.filter(r => r.url.includes('cdn.uab.org'));
  assert.deepEqual(upstreams.map(r => r.url), [registry.find(c => c.id === camera.id).url]);
  assert.equal(upstreams[0].init.redirect, 'manual');
  assert.ok(upstreams[0].init.signal);
  const media = await app.call('/media/bulgaria-sba-02?upstream=https://evil.test');
  assert.equal(media.status, 307);
  assert.equal(media.headers.Location, '/api/cctv/frame/bulgaria-sba-02');
  const stream = JSON.parse((await app.call('/stream/bulgaria-sba-02')).body);
  assert.equal(stream.feedType, 'image');
  assert.equal(stream.mediaUrl, null);
  const health = JSON.parse((await app.call('/health')).body).cameras.find(c => c.id === camera.id);
  assert.equal(health.status, 'ok');
  assert.equal(health.sourceKind, 'snapshot');
});

test('invalid camera IDs fail cleanly without fetching arbitrary URLs', async t => {
  const app = mount(t);
  await app.call('/sources');
  app.requests.length = 0;
  const frame = await app.call('/frame/bulgaria-sba-999?upstream=http://127.0.0.1/secret');
  assert.equal(frame.headers['X-CCTV-Source'], 'synthetic');
  assert.match(frame.body, /NO UPSTREAM CONFIGURED/);
  assert.equal((await app.call('/media/bulgaria-sba-999?url=https://evil.test')).status, 404);
  assert.equal((await app.call('/media/https%3A%2F%2F127.0.0.1%2Fsecret')).status, 404);
  assert.equal(app.requests.length, 0);
});

test('an offline Bulgarian image degrades only that camera and recovers on its next successful request', async t => {
  let offline = true;
  const app = mount(t, url => url.includes('cctv_110/') && offline ? new Response('', { status: 404 }) : imageResponse());
  const bad = await app.call('/frame/bulgaria-sba-110');
  assert.equal(bad.headers['X-CCTV-Source'], 'synthetic');
  assert.match(bad.body, /UPSTREAM UNAVAILABLE/);
  const good = await app.call('/frame/bulgaria-sba-02');
  assert.equal(good.headers['X-CCTV-Source'], 'upstream-image');
  const health = JSON.parse((await app.call('/health')).body).cameras;
  assert.equal(health.find(c => c.id === 'bulgaria-sba-110').status, 'degraded');
  assert.equal(health.find(c => c.id === 'bulgaria-sba-02').status, 'ok');
  assert.equal(JSON.parse((await app.call('/sources')).body).sources.filter(c => c.cityId === 'bulgaria').length, 15);
  offline = false;
  assert.equal((await app.call('/frame/bulgaria-sba-110')).headers['X-CCTV-Source'], 'upstream-image');
  assert.equal(JSON.parse((await app.call('/health')).body).cameras.find(c => c.id === 'bulgaria-sba-110').status, 'ok');
});

test('old SBA JPEGs remain visible with stale health, rather than being presented as current', async t => {
  const old = new Date(Date.now() - BULGARIA_STALE_FRAME_MS - 60_000).toUTCString();
  const app = mount(t, () => imageResponse(old));
  assert.deepEqual((await app.call('/frame/bulgaria-sba-115')).body, jpeg);
  const health = JSON.parse((await app.call('/health')).body).cameras[0];
  assert.equal(health.status, 'degraded');
  assert.equal(health.sourceKind, 'stale');
  assert.match(health.message, /older than 10 minutes.*last modified/);
});

test('missing, invalid and future modification dates never claim known freshness', async () => {
  for (const modified of [null, 'invalid', new Date(Date.now() + 86400_000).toUTCString()]) {
    const image = await fetchBulgariaSnapshot(registry[0].url, { fetchImpl: async () => imageResponse(modified) });
    assert.equal(image.health.status, 'degraded');
    assert.match(image.health.message, /freshness unknown/);
  }
});

test('SBA image validation rejects HTML, disguised non-images, oversized bodies and off-origin redirects', async () => {
  const url = registry[0].url;
  for (const response of [
    new Response('<html>offline</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('not a jpeg', { headers: { 'content-type': 'image/jpeg' } }),
    new Response(jpeg, { headers: { 'content-type': 'image/png' } }),
    imageResponse(),
  ]) {
    assert.equal(await fetchBulgariaSnapshot(url, { maxBytes: 7, fetchImpl: async () => response }), null);
  }
  const calls = [];
  const redirected = await fetchBulgariaSnapshot(url, { fetchImpl: async href => {
    calls.push(href);
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  } });
  assert.equal(redirected, null);
  assert.deepEqual(calls, [url]);
  assert.equal(await fetchBulgariaSnapshot('https://evil.test/frame.jpg', { fetchImpl: () => { throw new Error('Must not fetch'); } }), null);
});

test('a stalled SBA camera uses the shared bounded timeout', async () => {
  let signal;
  const started = Date.now();
  const result = await fetchBulgariaSnapshot(registry[0].url, {
    timeoutMs: 20,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  assert.equal(result, null);
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - started < 2000);
});
