const cacheLoader = require('../../cacheLoader');

module.exports = cacheLoader(function preloadJSBundle(bundle) {
  var link = document.createElement('link');
  link.charset = 'utf-8';
  link.rel = 'preload';
  link.as = 'script';
  link.href = bundle;
  document.getElementsByTagName('head')[0].appendChild(link);

  return Promise.resolve();
}, 'preload');
