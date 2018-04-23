/* eslint-disable no-unused-vars */

function $parcel$interopDefault(a) {
  return a && a.__esModule
    ? a.default
    : a;
}

function $parcel$exportWildcard(dest, source) {
  Object.keys(source).forEach(function(key) {
    if(key === "default" || key === "__esModule") {
      return;
    }

    Object.defineProperty(dest, key, {
      enumerable: true,
      get: function get() {
        return source[key];
      }
    });
  });

  return dest;
}
