/* global window */
var global = typeof self == 'undefined' ? window : self;
var env = global.chrome || global.browser;
env.runtime.onMessage.addListener(function(msg) {
  if (msg.__parcel_hmr_reload__) {
    env.runtime.reload();
  }
});
