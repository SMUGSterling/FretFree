'use strict';
// FretFree's service worker: after one visit the app, the library and any PDF or MIDI file a student opened keep
// working without internet. It only ever fetches from this site; requests to anywhere else are left alone.
//   - The page (index.html) is network-first, so a new deploy is picked up on the next reload; offline, the last copy
//     opens.
//   - ?v=-stamped scripts and styles are cache-first: bump-version.cjs changes the stamp whenever a file changes, so a
//     stamped URL never goes stale. The small ones are cached at install; the large catalogs are cached as they are
//     fetched, and the page hands over the ones it loaded before this worker was in charge (the 'keep' message).
//   - Files under scores/ are cached only when opened.
//   - Other files on this site (the manifest, icons, RIGHTS.md) are network-first with the cached copy as fallback.
// Cache names carry the scope, since every project on a github.io origin shares one CacheStorage.
const VERSION = 1,
  SCOPE = new URL(self.registration.scope),
  APP_CACHE = `fretfree-app-v${VERSION}:${SCOPE.pathname}`,
  SCORE_CACHE = `fretfree-scores-v${VERSION}:${SCOPE.pathname}`,
  PAGE = SCOPE.href,
  SHELL = ['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
// The stamped assets an index.html loads, as absolute URLs.
function stampedAssets(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+\?v=[^"]+)"/g)].map(m => new URL(m[1], PAGE).href);
}
const ownURL = url => url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname),
  isPage = url => ownURL(url) && (url.pathname === SCOPE.pathname || url.pathname === SCOPE.pathname + 'index.html'),
  isStamped = url => ownURL(url) && url.searchParams.has('v'),
  isScoreFile = url => ownURL(url) && url.pathname.startsWith(SCOPE.pathname + 'scores/'),
  // Only complete same-origin answers are kept: never errors, redirects or partial (range) responses.
  keepable = response => response && response.status === 200 && response.type === 'basic';
// Which strategy a request gets; null leaves it to the browser.
function route(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || !ownURL(url)) return null;
  if (request.mode === 'navigate' && !isScoreFile(url)) return 'page';
  if (isPage(url)) return 'page';
  if (isStamped(url)) return 'asset';
  if (isScoreFile(url)) return request.headers.has('range') ? null : 'score';
  return 'file';
}
async function put(cacheName, key, response) {
  if (!keepable(response)) return;
  try {
    await (await caches.open(cacheName)).put(key, response);
  } catch {}
}
// Drops cached assets that the current index.html no longer loads, so old deploys do not pile up.
async function prune(html) {
  const current = new Set(stampedAssets(html)),
    cache = await caches.open(APP_CACHE);
  for (const request of await cache.keys())
    if (isStamped(new URL(request.url)) && !current.has(request.url)) await cache.delete(request);
}
async function page(event) {
  const {request} = event,
    url = new URL(request.url),
    key = isPage(url) ? PAGE : request.url;
  try {
    // no-cache revalidates with the server, so a fresh deploy is never hidden behind the HTTP cache.
    const response = await fetch(request, {cache: 'no-cache'});
    if (keepable(response)) {
      const copy = response.clone();
      event.waitUntil(
        (async () => {
          await put(APP_CACHE, key, copy.clone());
          if (key === PAGE) await prune(await copy.text());
        })()
      );
    }
    return response;
  } catch (error) {
    const cache = await caches.open(APP_CACHE),
      cached = await cache.match(key, {ignoreSearch: true});
    if (cached) return cached;
    throw error;
  }
}
async function cacheFirst(event, cacheName) {
  const cached = await (await caches.open(cacheName)).match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  event.waitUntil(put(cacheName, event.request, response.clone()));
  return response;
}
async function file(event) {
  try {
    const response = await fetch(event.request);
    event.waitUntil(put(APP_CACHE, event.request, response.clone()));
    return response;
  } catch (error) {
    const cached = await (await caches.open(APP_CACHE)).match(event.request);
    if (cached) return cached;
    throw error;
  }
}
// Caches the stamped URLs it is given (from this site only) that are not cached yet.
async function keep(urls) {
  const cache = await caches.open(APP_CACHE);
  let kept = 0;
  for (const href of urls) {
    let url;
    try {
      url = new URL(href, PAGE);
    } catch {
      continue;
    }
    if (!isStamped(url)) continue;
    if (!(await cache.match(url.href))) {
      try {
        await put(APP_CACHE, url.href, await fetch(url.href));
      } catch {}
    }
    if (await cache.match(url.href)) kept++;
  }
  return kept;
}
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const response = await fetch(PAGE, {cache: 'no-cache'});
      if (!keepable(response)) throw new Error('index.html could not be fetched');
      const html = await response.clone().text(),
        cache = await caches.open(APP_CACHE);
      // The catalogs are most of the download; they are cached at runtime instead, so installing stays quick.
      const assets = stampedAssets(html).filter(href => !/\/catalog-[^/]*\.js\?/.test(href));
      await cache.addAll([...SHELL.map(path => new URL(path, PAGE).href), ...assets]);
      await cache.put(PAGE, response);
      await self.skipWaiting();
    })()
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (
          name.startsWith('fretfree-') &&
          name.endsWith(':' + SCOPE.pathname) &&
          ![APP_CACHE, SCORE_CACHE].includes(name)
        )
          await caches.delete(name);
      await self.clients.claim();
    })()
  );
});
self.addEventListener('fetch', event => {
  const strategy = route(event.request);
  if (strategy === 'page') event.respondWith(page(event));
  else if (strategy === 'asset') event.respondWith(cacheFirst(event, APP_CACHE));
  else if (strategy === 'score') event.respondWith(cacheFirst(event, SCORE_CACHE));
  else if (strategy === 'file') event.respondWith(file(event));
});
// The page lists the assets it loaded; the reply tells it how many are kept for offline use.
self.addEventListener('message', event => {
  if (event.data?.type !== 'keep' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    keep(event.data.urls.slice(0, 200)).then(kept =>
      event.source?.postMessage({type: 'kept', kept, total: event.data.urls.length})
    )
  );
});
