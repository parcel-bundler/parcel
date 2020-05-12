// @flow strict-local

import type {NamedBundle} from '@parcel/types';

import path from 'path';

export function relativeBundlePath(
  from: NamedBundle,
  to: NamedBundle,
  opts: {|leadingDotSlash: boolean|} = {leadingDotSlash: true},
) {
  let p = path
    .relative(path.dirname(from.filePath), to.filePath)
    .replace(/\\/g, '/');
  if (opts.leadingDotSlash && p[0] !== '.') {
    p = './' + p;
  }

  return p;
}
