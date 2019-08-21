var $parcel$modules = {};
var $parcel$modules$init = {};

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

globalObject.$parcel$modules = $parcel$modules;
globalObject.$parcel$modules$init = $parcel$modules$init;

globalObject.parcelRequire = function(name) {
  if (name in $parcel$modules) {
    if ($parcel$modules$init[name]) {
      $parcel$modules$init[name]();
    }
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

globalObject.parcelRequire.register = function register(id, exports, init) {
  $parcel$modules[id] = exports;
  if (init) {
    $parcel$modules$init[id] = init;
  }
};
