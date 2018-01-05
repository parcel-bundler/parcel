const url = require('url');
const path = require('path');
const isUrl = require('./is-url');

module.exports = function(publicURL, assetPath) {
  // Use url.format to resolve path when the publicURL is a url
  // Use url.resolve to normalize path for windows
  // from \path\to\res.js to /path/to/res.js

  if (isUrl(publicURL)) {
    const urlObj = url.parse(publicURL);
    const regexp = /[?#](.)*/;

    const rightUrlObj = Object.assign({}, urlObj, {
      href: urlObj.href.replace(regexp, ''),
      pathname: url.resolve(path.join(urlObj.pathname, assetPath), ''),
      path: url.resolve(
        `${path.join(
          urlObj.path.replace(regexp, ''),
          assetPath
        )}${urlObj.search || ''}${urlObj.hash || ''}`,
        ''
      )
    });

    return url.format(rightUrlObj);
  }

  return url.resolve(path.join(publicURL, assetPath), '');
};
