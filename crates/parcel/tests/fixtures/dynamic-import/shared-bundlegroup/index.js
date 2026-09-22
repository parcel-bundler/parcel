// Awaited in sequence: `Promise.all([import(), import()])` would make a and b
// one bundle, and this fixture needs c imported from two different bundles.
export default (async () => {
  const a = await import('./a.js');
  const b = await import('./b.js');
  return Promise.all([a.default, b.default]);
})();
