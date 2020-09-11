const cacheLoader = require('../../cacheLoader');

module.exports = cacheLoader(function prefetchJSBundle(bundle) {
  return new Promise(function(resolve, reject) {
    var link = document.createElement('link');

    // ? Is this needed
    // if (__webpack_require__.nc) {
    //   link.setAttribute("nonce", __webpack_require__.nc);
    // }
    link.rel = 'prefetch';
    link.as = 'script';
    link.href = bundle;
    document.getElementsByTagName('head')[0].appendChild(link);
  });
}, 'prefetch');
