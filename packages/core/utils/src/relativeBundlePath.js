// @flow strict-local

import type {NamedBundle} from '@parcel/types';

import path from 'path';
import {relativePath} from './path';

export function relativeBundlePath(
  from: NamedBundle,
  to: NamedBundle,
  opts: {|leadingDotSlash: boolean|} = {leadingDotSlash: true},
) {
  return relativePath(
    path.dirname(from.filePath),
    to.filePath,
    opts.leadingDotSlash,
  );
}
