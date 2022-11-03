output = Promise.all([
  import('./a').then(mod => mod.default),
  import('./b').then(mod => mod.default),
  import('./c').then(mod => mod.default)
]);
