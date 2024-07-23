function tier(loader) {
  const listeners = new Set();
  let mod = null;
  loader.then(loaded => {
    mod = loaded;
    for (let listener of listeners) {
      listener?.();
    }
  });
  return {
    get mod() {
      return mod;
    },
    onReady: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

module.exports = tier;
