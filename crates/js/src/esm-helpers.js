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

function $parcel$exportAll(source, dest, names) {
  // `names` are the public names of the exports of a module whose exports have private names (see
  // `private_star_export_names`), in the order of their private names, comma separated.
  (names === undefined ? Object.keys(source) : names.split(',')).forEach(
    function (key, index) {
      if (
        !key ||
        key === 'default' ||
        key === '__esModule' ||
        Object.prototype.hasOwnProperty.call(dest, key)
      ) {
        return;
      }

      var from = names === undefined ? key : privateName(index);
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

function $parcel$interopDefault(a) {
  return a && a.__esModule ? a : {default: a};
}

function $parcel$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true, configurable: true});
}
