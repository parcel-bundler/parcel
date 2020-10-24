function $parcel$interopDefault(a) {
  return a && a.__esModule ? a.default : a;
}

function $parcel$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true});
}

function $parcel$export(e, n, v) {
  Object.defineProperty(e, n, {get: v, enumerable: true});
}

function $parcel$exportWildcard(dest, source) {
  Object.keys(source).forEach(function(key) {
    if (key === 'default' || key === '__esModule') {
      return;
    }

    Object.defineProperty(dest, key, {
      enumerable: true,
      get: function get() {
        return source[key];
      },
    });
  });

  return dest;
}

function $parcel$missingModule(name) {
  var err = new Error("Cannot find module '" + name + "'");
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

var $parcel$global =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof self !== 'undefined'
    ? self
    : typeof window !== 'undefined'
    ? window
    : typeof global !== 'undefined'
    ? global
    : {};
