// @flow strict-local

import type {Bundle} from '@parcel/types';

import path from 'path';
import nullthrows from 'nullthrows';

export function relativeBundlePath(
  from: Bundle,
  to: Bundle,
  opts: {|leadingDotSlash: boolean|} = {leadingDotSlash: true},
) {
  let p = path
    .relative(path.dirname(nullthrows(from.filePath)), nullthrows(to.filePath))
    .replace(/\\/g, '/');
  if (opts.leadingDotSlash && p[0] !== '.') {
    p = './' + p;
  }

  return p;
}
