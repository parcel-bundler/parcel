export function load(loader) {
  var listeners = new Set();
  var resolved = false;
  if (loader instanceof Promise) {
    loader.then(mod => {
      resolved = true;
      for (let listener of listeners) {
        listener?.(mod.default);
      }
    });
  } else {
    resolved = true;
  }
  return {
    onReady: listener => {
      if (resolved) {
        listener(loader.default);
      } else {
        listeners.add(listener);
      }
    },
  };
}
