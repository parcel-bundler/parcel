output = (async () => {
  let mod = await import('./async-dep.js');
  let used = mod.usedDynamic;
  mod = null;
  return used;
})();
