/* exported $parcel$export, $parcel$interopDefault, $parcel$defineInteropFlag */

// The functions modules converted from ESM to CommonJS call directly, which the packager defines
// alongside them (see `ESM_HELPER_FUNCTIONS`), with `$parcel$exportAll` from esm-export-all.js.

// Defines a module's exports from an object of their getters by name (see `define_exports`), or
// one export, for `__proto__`.
function $parcel$export(dest, destName, get) {
  if (typeof destName === 'object') {
    Object.keys(destName).forEach(function (name) {
      $parcel$export(dest, name, destName[name]);
    });
    return;
  }
  Object.defineProperty(dest, destName, {
    enumerable: true,
    configurable: true,
    get: get,
  });
}

function $parcel$interopDefault(a) {
  return a && a.__esModule ? a : {default: a};
}

function $parcel$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true, configurable: true});
}
