'use strict';
// FretFree's service worker: after one visit the app, the library and any PDF or MIDI file a student opened keep
// working without internet. It only ever fetches from this site; requests to anywhere else are left alone.
//   - The page (index.html) is network-first, so a new deploy is picked up on the next reload; offline, the last
//     complete copy opens. A newly fetched page waits (NEXT_PAGE) until every stamped file it loads is cached; only then
//     does it become the offline copy and are the files only older pages loaded dropped. An update cut short by a lost
//     connection or a closed tab leaves the previous copy whole.
//   - ?v=-stamped scripts and styles are cache-first: bump-version.cjs changes the stamp whenever a file changes, so a
//     stamped URL never goes stale. The small ones are cached at install; the large catalogs are cached as they are
//     fetched, and the page hands over the ones it loaded before this worker was in charge (the 'keep' message).
//   - Files under scores/ are cached only when opened. Like other files on this site (the manifest, icons, RIGHTS.md)
//     they are network-first with the cached copy as fallback, so a corrected edition reaches students online.
// Cache names carry the scope, since every project on a github.io origin shares one CacheStorage.
const VERSION = 1,
  SCOPE = new URL(self.registration.scope),
  APP_CACHE = `fretfree-app-v${VERSION}:${SCOPE.pathname}`,
  SCORE_CACHE = `fretfree-scores-v${VERSION}:${SCOPE.pathname}`,
  PAGE = SCOPE.href,
  NEXT_PAGE = new URL('index.html?next', PAGE).href,
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
// Changes to the offline copy run one at a time, so an older check never undoes a newer page.
let queue = Promise.resolve();
const serial = task => (queue = queue.catch(() => {}).then(task));
// Stamped assets still being written to the cache, so the page's 'keep' message does not fetch them a second time.
const storing = new Map();
// Makes the waiting page the offline copy once every stamped asset it loads is cached, then drops the assets that only
// older pages loaded, so old deploys do not pile up.
async function settle() {
  const cache = await caches.open(APP_CACHE),
    next = await cache.match(NEXT_PAGE);
  if (!next) return;
  const current = new Set(stampedAssets(await next.clone().text()));
  for (const href of current) if (!(await cache.match(href))) return;
  await cache.put(PAGE, next);
  await cache.delete(NEXT_PAGE);
  for (const request of await cache.keys())
    if (isStamped(new URL(request.url)) && !current.has(request.url)) await cache.delete(request);
}
const stage = response =>
  serial(async () => {
    await put(APP_CACHE, NEXT_PAGE, response);
    await settle();
  });
async function page(event) {
  const {request} = event,
    url = new URL(request.url),
    key = isPage(url) ? PAGE : request.url;
  try {
    // no-cache revalidates with the server, so a fresh deploy is never hidden behind the HTTP cache.
    const response = await fetch(request, {cache: 'no-cache'});
    if (keepable(response))
      event.waitUntil(key === PAGE ? stage(response.clone()) : put(APP_CACHE, key, response.clone()));
    return response;
  } catch (error) {
    // Before the first copy is complete, the page that is still waiting opens with what has been cached so far.
    const cache = await caches.open(APP_CACHE),
      cached = (await cache.match(key, {ignoreSearch: true})) || (key === PAGE && (await cache.match(NEXT_PAGE)));
    if (cached) return cached;
    throw error;
  }
}
async function asset(event) {
  const {request} = event,
    cached = await (await caches.open(APP_CACHE)).match(request);
  if (cached) return cached;
  const response = await fetch(request),
    stored = put(APP_CACHE, request, response.clone())
      .then(() => serial(settle))
      .catch(() => {});
  storing.set(request.url, stored);
  event.waitUntil(stored.finally(() => storing.delete(request.url)));
  return response;
}
async function networkFirst(event, cacheName) {
  try {
    const response = await fetch(event.request);
    event.waitUntil(put(cacheName, event.request, response.clone()));
    return response;
  } catch (error) {
    const cached = await (await caches.open(cacheName)).match(event.request);
    if (cached) return cached;
    throw error;
  }
}
// Caches the stamped URLs it is given (from this site only) that are not cached yet, and counts them.
async function keep(urls) {
  const cache = await caches.open(APP_CACHE);
  let kept = 0,
    total = 0;
  for (const href of urls) {
    let url;
    try {
      url = new URL(href, PAGE);
    } catch {
      continue;
    }
    if (!isStamped(url)) continue;
    total++;
    await storing.get(url.href);
    if (!(await cache.match(url.href))) {
      try {
        await put(APP_CACHE, url.href, await fetch(url.href));
      } catch {}
    }
    if (await cache.match(url.href)) kept++;
  }
  return {kept, total};
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
      await stage(response);
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
  else if (strategy === 'asset') event.respondWith(asset(event));
  else if (strategy === 'score') event.respondWith(networkFirst(event, SCORE_CACHE));
  else if (strategy === 'file') event.respondWith(networkFirst(event, APP_CACHE));
});
// The page lists the assets it loaded; the reply tells it how many of its stamped ones are kept for offline use.
self.addEventListener('message', event => {
  if (event.data?.type !== 'keep' || !Array.isArray(event.data.urls)) return;
  event.waitUntil(
    (async () => {
      const counts = await keep(event.data.urls.slice(0, 200));
      await serial(settle).catch(() => {});
      event.source?.postMessage({type: 'kept', ...counts});
    })()
  );
});
