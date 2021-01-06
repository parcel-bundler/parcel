output = Promise.all([
  import('./async-has-dep').then(mod => mod.default),
  import('./get-dep').then(mod => mod.default)
]);
