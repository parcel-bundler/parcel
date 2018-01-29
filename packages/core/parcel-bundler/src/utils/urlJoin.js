const URL = require('url');
const path = require('path');

/**
 * Joins a path onto a URL, and normalizes Windows paths
 * e.g. from \path\to\res.js to /path/to/res.js.
 */
module.exports = function(publicURL, assetPath) {
  const url = URL.parse(publicURL, false, true);
  const assetUrl = URL.parse(assetPath);
  url.pathname = path.posix.join(url.pathname, assetUrl.pathname);
  url.search = assetUrl.search;
  url.hash = assetUrl.hash;
  return URL.format(url);
};
