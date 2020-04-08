export default Promise.all([
  import('./value').then(mod => mod.default),
  import('./async').then(mod => mod.default),
]);
