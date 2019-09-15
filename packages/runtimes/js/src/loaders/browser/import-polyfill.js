let cache = {};

module.exports = function importModule(bundle) {
  return new Promise((resolve, reject) => {
    // Resolve url to absolute
    let a = document.createElement('a');
    a.href = bundle;

    // Check the cache
    if (cache[a.href]) {
      return resolve(cache[a.href]);
    }

    // Add a global function to handle when the script loads.
    let globalName = `i${('' + Math.random()).slice(2)}`;
    global[globalName] = m => {
      cache[a.href] = m;
      resolve(m);
      cleanup();
    };

    // Remove script on load or error
    let cleanup = () => {
      delete global[globalName];
      script.onerror = null;
      script.remove();
    };

    // Append an inline script tag into the document head
    let script = document.createElement('script');
    script.async = true;
    script.type = 'module';
    script.charset = 'utf-8';
    script.textContent = `import * as m from '${a.href}'; ${globalName}(m);`;
    script.onerror = function(e) {
      reject(e);
      cleanup();
    };

    document.head.appendChild(script);
  });
};
