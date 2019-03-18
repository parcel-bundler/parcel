module.exports = function loadCSSBundle(bundle) {
  return new Promise((resolve, reject) => {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = bundle;
    link.onerror = e => {
      link.onerror = link.onload = null;
      reject(e);
    };

    link.onload = () => {
      link.onerror = link.onload = null;
      resolve();
    };

    document.getElementsByTagName('head')[0].appendChild(link);
  });
};
