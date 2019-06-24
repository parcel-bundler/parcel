// @flow strict-local

import URL from 'url';
import path from 'path';

/**
 * Joins a path onto a URL, and normalizes Windows paths
 * e.g. from \path\to\res.js to /path/to/res.js.
 */
export default function urlJoin(publicURL: string, assetPath: string): string {
  const url = URL.parse(publicURL, false, true);
  const assetUrl = URL.parse(assetPath);
  url.pathname = path.posix.join(url.pathname, assetUrl.pathname);
  url.search = assetUrl.search;
  url.hash = assetUrl.hash;
  return URL.format(url);
}
