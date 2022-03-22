/* global chrome, browser */
var env = typeof chrome == 'undefined' ? browser : chrome;
addEventListener('beforeunload', function () {
  env.runtime.sendMessage({
    __parcel_hmr_reload__: true,
  });
});
