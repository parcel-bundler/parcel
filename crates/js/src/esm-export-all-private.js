/* exported $parcel$exportAll */

// Re-exports a module's exports for `export *` in an optimized app (see esm-helpers.js), where
// a module's exports may have private names. Then, `names` is an array of their public names in
// the order of their private names, with holes for those it doesn't copy (see
// `private_star_export_names`). Its strings are literals, which are interned when parsed, so
// defining properties by them is as fast as by `Object.keys`.
function $parcel$exportAll(source, dest, names) {
  (names || Object.keys(source)).forEach(
    function (key, index) {
      if (
        key === 'default' ||
        key === '__esModule' ||
        Object.prototype.hasOwnProperty.call(dest, key)
      ) {
        return;
      }

      var from = names ? privateName(index) : key;
      Object.defineProperty(dest, key, {
        enumerable: true,
        configurable: true,
        get: function () {
          return source[from];
        },
      });
    },
  );

  return dest;

  // Matches `private_export_name` in the JS packager.
  function privateName(index) {
    var first = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
    var rest = first + '0123456789';
    var name = first[index % 54];
    index = Math.floor(index / 54);
    while (index > 0) {
      index--;
      name += rest[index % 64];
      index = Math.floor(index / 64);
    }
    return name;
  }
}
