// @flow

import type {FilePath} from '@parcel/types';

import _isGlob from 'is-glob';
import fastGlob, {type FastGlobOptions} from 'fast-glob';

function normalisePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function isGlob(p: FilePath) {
  return _isGlob(normalisePath(p));
}

export function globSync(
  p: FilePath,
  options: FastGlobOptions<FilePath>
): Array<FilePath> {
  return fastGlob.sync(normalisePath(p), options);
}

export function glob(
  p: FilePath,
  options: FastGlobOptions<FilePath>
): Promise<Array<FilePath>> {
  return fastGlob(normalisePath(p), options);
}
