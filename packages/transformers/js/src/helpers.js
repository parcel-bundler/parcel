export function interopDefault(a) {
  return a && a.__esModule ? a.default : a;
}

export function defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true});
}

export function namespace(source, dest = {}) {
  Object.keys(source).forEach(function(key) {
    if (key === 'default' || key === '__esModule') {
      return;
    }

    Object.defineProperty(dest, key, {
      enumerable: true,
      get() {
        return source[key];
      },
    });
  });

  return dest;
}

export function reexport(dest, destName, source, sourceName) {
  Object.defineProperty(dest, destName, {
    enumerable: true,
    get() {
      if (sourceName === 'default') {
        return interopDefault(source);
      }

      return source[sourceName];
    },
  });
}
