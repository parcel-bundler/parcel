output = Promise.all([
  import('./async1').then(m => m.default),
  import('./async2').then(m => m.default),
]);
