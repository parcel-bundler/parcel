/* global chrome, browser, addEventListener */
var env = typeof chrome == 'undefined' ? browser : chrome;
addEventListener('beforeunload', function () {
  try {
    env.runtime.sendMessage({
      __parcel_hmr_reload__: true,
    });
  } catch (err) {
    // ignore throwing if extension context invalidated
  }
});

env.runtime.onMessage.addListener(function (msg) {
  if (msg.__parcel_hmr_reload__) {
    setTimeout(function () {
      location.reload();
    }, 50);
  }
});
