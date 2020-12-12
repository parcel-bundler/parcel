const cacheLoader = require('@parcel/runtime-js/src/cacheLoader');

module.exports = cacheLoader(function preloadJSBundle(
  bundle,
  priority,
  isModule,
) {
  var link = document.createElement('link');
  link.charset = 'utf-8';
  link.rel = isModule ? 'modulepreload' : 'preload';
  link.href = bundle;
  if (priority) {
    link.as = priority;
  }

  document.getElementsByTagName('head')[0].appendChild(link);
  return Promise.resolve();
},
'preload');
