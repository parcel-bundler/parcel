module.exports = function loadJSBundle(bundle) {
  return new Promise((resolve, reject) => {
    var script = document.createElement('script');
    script.async = true;
    script.type = 'text/javascript';
    script.charset = 'utf-8';
    script.src = bundle;
    script.onerror = e => {
      script.onerror = script.onload = null;
      reject(e);
    };

    script.onload = () => {
      script.onerror = script.onload = null;
      resolve();
    };

    document.getElementsByTagName('head')[0].appendChild(script);
  });
};
