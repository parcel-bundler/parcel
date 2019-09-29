// @flow
import type {Bundle} from '@parcel/types';
import path from 'path';
import nullthrows from 'nullthrows';

export function relativeBundlePath(from: Bundle, to: Bundle) {
  let p = path
    .relative(path.dirname(nullthrows(from.filePath)), nullthrows(to.filePath))
    .replace(/\\/g, '/');
  if (p[0] !== '.') {
    p = './' + p;
  }

  return p;
}
