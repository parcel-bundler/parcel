const url = require('url');
const path = require('path');

module.exports = function(publicURL, assetPath) {
  // Use url.resolve to normalize path for windows
  // from \path\to\res.js to /path/to/res.js
  return url.resolve(path.join(publicURL, assetPath), '');
};
