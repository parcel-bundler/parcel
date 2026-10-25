output = (async () => {
  function getUsed() {
    return mod.usedDynamic;
  }
  const mod = await import('./async-dep.js');
  return getUsed() + ' ' + mod.otherDynamic;
})();
