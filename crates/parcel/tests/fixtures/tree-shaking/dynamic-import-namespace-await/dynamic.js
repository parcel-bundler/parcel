output = (async () => {
  const mod = await import('./async-dep.js');
  return mod.usedDynamic;
})();
