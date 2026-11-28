// An ES module, which doesn't read the exports objects of what it imports, unlike CommonJS.
export {};

output = Promise.all([
  // Only reads `default`, so the module needs no `__esModule` flag, nor interop.
  import('./lazy.js').then(({default: lazy}) => lazy),
  // Given the namespace object, which may read the flag.
  import('./escaped.js').then(ns => [ns][0].__esModule),
]).then(values => values.join(':'));
