/* global chrome, browser, addEventListener, fetch, Response, HMR_HOST, HMR_PORT */
var env = typeof chrome == 'undefined' ? browser : chrome;
var autoReload = false;

var origReload = env.runtime.reload;
env.runtime.reload = function () {
  var reloadOnce = false;
  function reloadTabs(tabs) {
    for (let i = 0; i < tabs.length; ++i) {
      env.tabs.sendMessage(
        tabs[i].id,
        {__parcel_hmr_reload__: true},
        {},
        function () {},
      );
    }
    if (reloadOnce) {
      origReload.call(env.runtime);
    } else {
      reloadOnce = true;
    }
  }
  env.tabs.query({highlighted: true}, reloadTabs);
  env.tabs.query({highlighted: false}, reloadTabs);
};

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
