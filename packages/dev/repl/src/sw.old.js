const mime = {
  html: 'text/html',
  js: 'application/js',
  css: 'text/css',
};
function extension(f) {
  const parts = f.split('.');
  return parts.length >= 2 ? parts[parts.length - 1] : null;
}

const CACHE_NAME = 'cache';
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.delete(CACHE_NAME));
});

const fs = {};
self.fs = fs;

self.addEventListener('message', evt => {
  const client = 'main'; //evt.source.id;
  fs[client] = evt.data;
  evt.source.postMessage('ok');
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.hostname == self.location.hostname) {
    event.respondWith(
      (async () => {
        const clientId = event.clientId || event.resultingClientId;

        const client = (
          await self.clients.matchAll({
            includeUncontrolled: true,
          })
        ).find(v => v.id === clientId);

        if (
          (client && client.frameType === 'nested') ||
          (event.resultingClientId && url.hash === '#parcel_preview')
        ) {
          if (process.env.NODE_ENV === 'development') {
            // eslint-disable-next-line no-console
            console.log(`📦 Serving from Parcel bundle: ${url.pathname}`);
          }
          // serve Parcel output
          const path = url.pathname.split('/').filter(Boolean);

          let data = fs['main']['dist'];
          for (let part of path) {
            if (part in data) data = data[part];
            else return new Response({status: 404});
          }

          return new Response(data, {
            headers: {
              'Content-Type': mime[extension(url.pathname)],
            },
          });
        } else {
          // return fetch(event.request);

          // stale-while-revalidate REPL bundle
          const fetchRequest = fetch(event.request);
          const cache = await caches.match(event.request);

          fetchRequest.then(async fetchResponse => {
            if (fetchResponse) {
              (await caches.open(CACHE_NAME)).put(
                event.request,
                fetchResponse.clone(),
              );
            }
          });

          if (cache) {
            if (process.env.NODE_ENV === 'development') {
              // eslint-disable-next-line no-console
              console.info(`🗄️ Serving ${event.request.url} from cache`);
            }
            return cache;
          } else {
            if (process.env.NODE_ENV === 'development') {
              // eslint-disable-next-line no-console
              console.info(
                `🚀 Falling back to network for ${event.request.url}`,
              );
            }
            return (await fetchRequest).clone();
          }
        }
      })(),
    );
  }
});
