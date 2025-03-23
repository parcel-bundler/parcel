// @flow strict-local

import URL from 'url';
import path from 'path';

/**
 * Joins a path onto a URL, and normalizes Windows paths
 * e.g. from \path\to\res.js to /path/to/res.js.
 */
export default function urlJoin(
  publicURL: string,
  assetPath: string,
  leadingDotSlash: boolean = false,
): string {
  const url = URL.parse(publicURL, false, true);
  // Leading / ensures that paths with colons are not parsed as a protocol.
  let p = assetPath.startsWith('/') ? assetPath : '/' + assetPath;
  const assetUrl = URL.parse(p);
  url.pathname = path.posix.join(url.pathname, assetUrl.pathname);
  url.search = assetUrl.search;
  url.hash = assetUrl.hash;
  let result = URL.format(url);
  if (
    url.host == null &&
    result[0] !== '/' &&
    result[0] !== '.' &&
    leadingDotSlash
  ) {
    result = './' + result;
  }
  return result;
}
