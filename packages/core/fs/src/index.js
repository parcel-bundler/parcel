// @flow strict-local

import type {FilePath} from '@parcel/types';
import type {FSPromise, Stats} from 'fs';

import {promisify} from 'util';
import fs from 'fs';
import _mkdirp from 'mkdirp';
import _rimraf, {type Options as RimrafOptions} from 'rimraf';

// Most of this can go away once we only support Node 10+, which includes
// require('fs').promises

export const readFile: $PropertyType<FSPromise, 'readFile'> = promisify(
  fs.readFile
);

export const writeFile: $PropertyType<FSPromise, 'writeFile'> = promisify(
  fs.writeFile
);

export const stat: $PropertyType<FSPromise, 'stat'> = promisify(fs.stat);

export const readdir: $PropertyType<FSPromise, 'readdir'> = promisify(
  fs.readdir
);

export const unlink: $PropertyType<FSPromise, 'unlink'> = promisify(fs.unlink);

const _realpath = promisify(fs.realpath);
export const realpath: $PropertyType<FSPromise, 'realpath'> = function(
  originalPath
) {
  try {
    return _realpath(originalPath);
  } catch (e) {
    // do nothing
  }

  return originalPath;
};

export const lstat: (path: string) => Promise<Stats> = promisify(fs.lstat);

export const exists = function(filename: FilePath): Promise<boolean> {
  return new Promise(resolve => {
    fs.exists(filename, resolve);
  });
};

export const mkdirp: (path: FilePath) => Promise<void> = promisify(_mkdirp);

export const rimraf: (
  path: FilePath,
  options?: RimrafOptions
) => Promise<void> = promisify(_rimraf);
