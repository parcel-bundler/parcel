/* global chrome, browser, addEventListener */
var env = typeof browser == 'undefined' ? chrome : browser;

addEventListener('beforeunload', function () {
  try {
    env.runtime.sendMessage({
      __parcel_hmr_reload__: true,
    });
    // spinlock for 500ms to let background reload
    let end = Date.now() + 500;
    while (Date.now() < end);
  } catch (err) {
    // ignore throwing if extension context invalidated
  }
});

env.runtime.onMessage.addListener(function (msg) {
  if (msg.__parcel_hmr_reload__) {
    setTimeout(function () {
      location.reload();
    }, 400);
  }
});
