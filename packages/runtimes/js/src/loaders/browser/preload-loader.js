const cacheLoader = require('../../cacheLoader');

module.exports = cacheLoader(function preloadJSBundle(bundle, priority) {
  var link = document.createElement('link');
  link.charset = 'utf-8';
  link.rel = 'preload';
  link.href = bundle;
  if (priority) {
    link.as = priority;
  }

  document.getElementsByTagName('head')[0].appendChild(link);
  return Promise.resolve();
}, 'preload');
