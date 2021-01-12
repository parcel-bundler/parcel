/* global window */
var env = window.chrome || window.browser;
env.runtime.onMessage.addListener(function(msg) {
  if (msg.__parcel_hmr_reload__) {
    env.runtime.reload();
  }
});
