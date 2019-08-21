// @flow strict-local

import URL from 'url';
import path from 'path';

/**
 * Joins a path onto a URL, and normalizes Windows paths
 * e.g. from \path\to\res.js to /path/to/res.js.
 */
export default function urlJoin(
  publicURL: string,
  ...paths: Array<string>
): string {
  const url = URL.parse(publicURL, false, true);
  url.pathname = path.posix.join(
    url.pathname,
    ...paths.map(path => URL.parse(path).pathname)
  );
  let lastParsed = URL.parse(paths[paths.length - 1]);
  url.search = lastParsed.search;
  url.hash = lastParsed.hash;
  return URL.format(url);
}
