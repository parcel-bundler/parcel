output = (async () => {
  function getUsed() {
    return usedDynamic;
  }
  const {usedDynamic, otherDynamic} = await import('./async-dep.js');
  return getUsed() + ' ' + otherDynamic;
})();
