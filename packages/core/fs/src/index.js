// @flow strict-local

import type {FilePath} from '@parcel/types';
import type {Readable} from 'stream';
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

export const exists = function(filePath: FilePath): Promise<boolean> {
  return new Promise(resolve => {
    fs.exists(filePath, resolve);
  });
};

export const mkdirp: (path: string) => Promise<void> = promisify(_mkdirp);

export const rimraf: (
  path: FilePath,
  options?: RimrafOptions
) => Promise<void> = promisify(_rimraf);

export function writeFileStream(
  filePath: FilePath,
  stream: Readable
): Promise<void> {
  return new Promise((resolve, reject) => {
    stream
      .pipe(fs.createWriteStream(filePath))
      .on('finish', resolve)
      .on('error', reject);
  });
}
