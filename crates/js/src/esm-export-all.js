/* exported $parcel$exportAll */

// Re-exports a module's exports for `export *` (see esm-helpers.js).
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
