const cache = require('../../cache');

module.exports = cache(function loadHTMLBundle(bundle) {
  return fetch(bundle).then(function(res) {
    return res.text();
  });
});
