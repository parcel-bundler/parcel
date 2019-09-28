// @flow

import type {FilePath} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

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
  fs: FileSystem,
  options: FastGlobOptions<FilePath>
): Promise<Array<FilePath>> {
  // $FlowFixMe
  options = {
    ...options,
    fs: {
      stat: async (p, cb) => {
        try {
          cb(null, await fs.stat(p));
        } catch (err) {
          cb(err);
        }
      },
      readdir: async (p, opts, cb) => {
        try {
          cb(null, await fs.readdir(p, opts));
        } catch (err) {
          cb(err);
        }
      }
    }
  };

  return fastGlob(normalisePath(p), options);
}
