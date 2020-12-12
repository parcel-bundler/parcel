const cacheLoader = require('@parcel/runtime-js/src/cacheLoader');

module.exports = cacheLoader(function loadHTMLBundle(bundle) {
  return fetch(bundle).then(function(res) {
    return res.text();
  });
});
