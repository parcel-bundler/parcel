const mime = {
  html: 'text/html',
  js: 'application/js',
  css: 'text/css'
};
function extension(f) {
  const parts = f.split('.');
  return parts.length >= 2 ? parts[parts.length - 1] : null;
}

self.addEventListener('install', event => {
  self.skipWaiting();
});

const fs = {};
self.fs = fs;

async function handleFetch(event) {
  const clientId = event.clientId || event.resultingClientId;

  const client = (await clients.matchAll({includeUncontrolled: true})).find(
    v => v.id === clientId
  );
  const url = new URL(event.request.url);

  // console.log(event);
  if (
    (client && client.frameType === 'nested') ||
    (event.resultingClientId && url.hash === '#parcel_preview')
  ) {
    const path = url.pathname.split('/').filter(Boolean);

    let data = fs['main']['dist'];
    for (let part of path) {
      if (part in data) data = data[part];
      else return new Response({status: 404});
    }

    return new Response(data, {
      headers: {
        'Content-Type': mime[extension(url.pathname)]
      }
    });
  } else {
    return fetch(event.request);
  }
}

self.addEventListener('fetch', event => {
  event.respondWith(handleFetch(event));
});

self.addEventListener('message', evt => {
  const client = 'main'; //evt.source.id;
  fs[client] = evt.data;
  evt.source.postMessage('ok');
});
