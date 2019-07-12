function loadViaScript(bundle, resolve, reject) {
  var script = document.createElement('script');
  script.async = true;
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.src = bundle;
  script.onerror = function (e) {
    script.onerror = script.onload = null;
    reject(e);
  };

  script.onload = function () {
    script.onerror = script.onload = null;
    resolve();
  };

  document.getElementsByTagName('head')[0].appendChild(script);
}

module.exports = function loadJSBundle(bundle) {
  return new Promise(function (resolve, reject) {
    if (typeof document !== 'undefined') {
      loadViaScript(bundle, resolve, reject);
    } else {
      try {
        self.importScripts(bundle);
        resolve();
      } catch (e) {
        reject(e);
      }
    }
  });
};
