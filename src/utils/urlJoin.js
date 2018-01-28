const URL = require('url');
const path = require('path');

/**
 * Joins a path onto a URL, and normalizes Windows paths
 * e.g. from \path\to\res.js to /path/to/res.js.
 */
module.exports = function(publicURL, assetPath) {
  const url = URL.parse(publicURL, false, true);
  url.pathname = path.posix.join(url.pathname, URL.parse(assetPath).pathname);
  return URL.format(url);
};
