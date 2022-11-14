// eslint-disable-next-line no-redeclare
/* global chrome, browser, addEventListener, fetch, Response, HMR_HOST, HMR_PORT */
var env = typeof chrome == 'undefined' ? browser : chrome;
env.runtime.onMessage.addListener(function (msg) {
  if (msg.__parcel_hmr_reload__) {
    env.runtime.reload();
  }
});

if (env.runtime.getManifest().manifest_version == 3) {
  var proxyLoc = env.runtime.getURL('/__parcel_hmr_proxy__?url=');
  addEventListener('fetch', function (evt) {
    var url = evt.request.url;
    if (url.startsWith(proxyLoc)) {
      url = new URL(decodeURIComponent(url.slice(proxyLoc.length)));
      if (url.hostname == HMR_HOST && url.port == HMR_PORT) {
        evt.respondWith(
          fetch(url).then(function (res) {
            return new Response(res.body, {
              headers: {
                'Content-Type': res.headers.get('Content-Type'),
              },
            });
          }),
        );
      }
    }
  });
}
