output = (async () => {
  const {usedDynamic} = await import('./async-dep.js');
  return usedDynamic;
})();
