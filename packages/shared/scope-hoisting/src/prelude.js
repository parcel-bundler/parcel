var $parcel$modules = {};

/* eslint-disable no-undef */
var globalObject =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : typeof window !== 'undefined'
    ? window
    : typeof global !== 'undefined'
    ? global
    : {};
/* eslint-enable no-undef */

globalObject.parcelRequire = function(name) {
  if (name in $parcel$modules) {
    return $parcel$modules[name];
  }

  // Try the node require function if it exists.
  // Do not use `require` to prevent Webpack from trying to bundle this call
  if (typeof module !== 'undefined' && typeof module.require === 'function') {
    return module.require(name);
  }

  var err = new Error("Cannot find module '" + name + "'");
  err.code = 'MODULE_NOT_FOUND';
  throw err;
};

globalObject.parcelRequire.register = function register(id, exports) {
  $parcel$modules[id] = exports;
};
