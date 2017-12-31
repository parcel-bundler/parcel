const url = require('url');
const path = require('path');
const isUrl = require('./is-url');

module.exports = function(publicURL, assetPath) {
  // Use url.resolve to resolve path when the publicURL is a url
  // Use path.normalize to normalize path for windows
  // from \path\to\res.js to /path/to/res.js

  return isUrl(publicURL)
    ? url.resolve(publicURL, assetPath)
    : path.normalize(path.join(publicURL, assetPath));
};
