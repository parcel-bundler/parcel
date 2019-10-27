// @flow

type Manifest = {|
  [string]: string
|};

export function createServiceWorker(manifestUrl: string) {
  let manifest,
    cache,
    handlers = [];

  async function getCache() {
    return cache || (cache = await caches.open('parcel-cache-v1'));
  }

  async function updateManifest() {
    console.log('update manifest');
    try {
      let res = await fetch(manifestUrl);
      let cache = await getCache();
      cache.put(manifestUrl, res.clone());
      manifest = await res.json();
    } catch (err) {
      console.log('error updating manifest', err);
    }
  }

  async function getManifest() {
    if (manifest) {
      return manifest;
    }

    let cache = await getCache();
    let response = await cache.match(manifestUrl);
    if (response) {
      manifest = await response.json();
      return manifest;
    }

    await updateManifest();
    return manifest;
  }

  async function install() {
    await updateManifest();
  }

  self.addEventListener('install', event => {
    event.waitUntil(install());
  });

  async function activate() {
    // Delete old unused keys from the cache
    let cache = await getCache();
    let cachedKeys = await cache.keys();
    for (let request of cachedKeys) {
      if (
        request.url !== manifestUrl &&
        getCacheUrl(request.url) !== request.url
      ) {
        console.log('delete', request.url);
        await cache.delete(request);
      }
    }
  }

  self.addEventListener('activate', event => {
    event.waitUntil(activate());
  });

  async function getCacheUrl(href) {
    let url = new URL(href);
    let path = url.pathname.slice(1);
    let manifest = await getManifest();
    let mapping =
      manifest[path] ||
      manifest[
        path && !path.endsWith('/') ? path + '/index.html' : path + 'index.html'
      ];
    if (!mapping) {
      return;
    }

    url.searchParams.set('v', mapping);
    return url.href;
  }

  async function getResponse(event) {
    if (event.request.method !== 'GET') {
      return continuePropagation(event);
    }

    if (isReload(event)) {
      await updateManifest();
    }

    let cacheUrl = await getCacheUrl(event.request.url);
    if (!cacheUrl) {
      return continuePropagation(event);
    }

    let cache = await getCache();
    let response = await cache.match(cacheUrl);

    if (response) {
      console.log(cacheUrl, 'from cache');
      return response;
    }

    response = await fetch(cacheUrl);
    if (!response || response.status !== 200 || response.type !== 'basic') {
      return response;
    }

    cache.put(cacheUrl, response.clone());
    console.log(cacheUrl, 'from network');
    return response;
  }

  function isReload(event) {
    // TODO: Safari doesn't set cache to 'no-cache' on reload :(
    return event.request.mode === 'navigate'; // && event.request.cache === 'no-cache';
  }

  self.addEventListener('fetch', (event: FetchEvent) => {
    console.log(
      event.request.url,
      event.request.mode,
      event.isReload,
      event.request.cache,
      manifest
    );
    event.respondWith(getResponse(event));
  });

  // There is no way to continue event propagation after event.respondWith is called.
  // This means that if we don't match a URL to a Parcel asset defined in the manifest,
  // we cannot fall back to other fetch handlers a user may have in their service worker.
  // In order to work around this, we monkey patch addEventListener so that subsequent
  // fetch event listeners are registered with us instead of the service worker directly.
  // That way we can trigger any subsequent handlers ourselves, and forward the response.
  let addEventListener = self.addEventListener;
  self.addEventListener = (event, fn) => {
    if (event === 'fetch') {
      handlers.push(fn);
    } else {
      addEventListener(event, fn);
    }
  };

  function continuePropagation(event) {
    // Monkey patch event.respondWith so we can intercept responses from other handlers
    // and return them to the original promise.
    let res = null;
    // $FlowFixMe
    event.respondWith = r => {
      res = r;
    };

    for (let handler of handlers) {
      handler(event);
      if (res) {
        return res;
      }
    }

    return fetch(event.request);
  }
}
