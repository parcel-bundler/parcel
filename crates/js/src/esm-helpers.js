/* exported $parcel$export, $parcel$exportAll, $parcel$interopDefault, $parcel$defineInteropFlag */

// The ESM helpers as functions of an optimized app bundle, which its modules call directly (see
// `ESM_HELPER_FUNCTIONS`). Keep in sync with `runtime_modules/esmodule-helpers.js`.

function $parcel$export(dest, destName, get) {
  Object.defineProperty(dest, destName, {
    enumerable: true,
    configurable: true,
    get: get,
  });
}

function $parcel$exportAll(source, dest) {
  Object.keys(source).forEach(function (key) {
    if (
      key === 'default' ||
      key === '__esModule' ||
      Object.prototype.hasOwnProperty.call(dest, key)
    ) {
      return;
    }

    Object.defineProperty(dest, key, {
      enumerable: true,
      configurable: true,
      get: function () {
        return source[key];
      },
    });
  });

  return dest;
}

function $parcel$interopDefault(a) {
  return a && a.__esModule ? a : {default: a};
}

function $parcel$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true, configurable: true});
}
