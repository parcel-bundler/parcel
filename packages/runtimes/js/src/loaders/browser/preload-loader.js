const cacheLoader = require('../../cacheLoader');

module.exports = cacheLoader(function preloadJSBundle(bundle) {
  return new Promise(function(resolve, reject) {
    var link = document.createElement('link');

    link.charset = 'utf-8';
    // ? Is this needed
    //link.setAttribute("nonce", __webpack_require__.nc);
    link.rel = 'preload';
    link.as = 'script';
    link.href = bundle;
    document.getElementsByTagName('head')[0].appendChild(link);
  });
}, 'preload');
