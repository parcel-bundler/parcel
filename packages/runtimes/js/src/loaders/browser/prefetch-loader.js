const cacheLoader = require('../../cacheLoader');

module.exports = cacheLoader(function prefetchJSBundle(bundle) {
  var link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'script';
  link.href = bundle;
  document.getElementsByTagName('head')[0].appendChild(link);

  return Promise.resolve();
});
