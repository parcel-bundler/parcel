// eslint-disable-next-line no-unused-vars
function $parcel$interopDefault(a) {
  return a && a.__esModule ? {d: a.default} : {d: a};
}

// eslint-disable-next-line no-unused-vars
function $parcel$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true});
}

// eslint-disable-next-line no-unused-vars
function $parcel$exportWildcard(dest, source) {
  Object.keys(source).forEach(function(key) {
    if (key === 'default' || key === '__esModule') {
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

// eslint-disable-next-line no-unused-vars
function $parcel$missingModule(name) {
  var err = new Error("Cannot find module '" + name + "'");
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

// eslint-disable-next-line no-unused-vars
var $parcel$global = this;
