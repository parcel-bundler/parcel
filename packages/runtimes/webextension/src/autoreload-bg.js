/* global chrome, browser */
var env = typeof chrome == 'undefined' ? browser : chrome;
env.runtime.onMessage.addListener(function (msg) {
  if (msg.__parcel_hmr_reload__) {
    env.runtime.reload();
  }
});
