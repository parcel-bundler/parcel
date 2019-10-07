// @flow

import type {FilePath, Glob} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

import _isGlob from 'is-glob';
import fastGlob, {type FastGlobOptions} from 'fast-glob';
import {isMatch} from 'micromatch';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function isGlob(p: FilePath) {
  return _isGlob(normalizePath(p));
}

export function isGlobMatch(filePath: FilePath, glob: Glob) {
  return isMatch(filePath, normalizePath(glob));
}

export function globSync(
  p: FilePath,
  options: FastGlobOptions<FilePath>
): Array<FilePath> {
  return fastGlob.sync(normalizePath(p), options);
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
      lstat: async (p, cb) => {
        // Our FileSystem interface doesn't have lstat support at the moment,
        // but this is fine for our purposes since we follow symlinks by default.
        try {
          cb(null, await fs.stat(p));
        } catch (err) {
          cb(err);
        }
      },
      readdir: async (p, opts, cb) => {
        if (typeof opts === 'function') {
          cb = opts;
          opts = null;
        }

        try {
          cb(null, await fs.readdir(p, opts));
        } catch (err) {
          cb(err);
        }
      }
    }
  };

  return fastGlob(normalizePath(p), options);
}
