/* global window */
window.addEventListener('beforeunload', function() {
  (window.chrome || window.browser).runtime.sendMessage({
    __parcel_hmr_reload__: true,
  });
});
