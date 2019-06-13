// @flow strict-local

import type {FilePath} from '@parcel/types';
import type {Readable} from 'stream';
import type {FSPromise, Stats} from 'fs';
import type {NcpOptions} from 'ncp';

import {promisify} from 'util';
import fs from 'fs';
import _ncp from 'ncp';
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

export const copyFile: $PropertyType<FSPromise, 'copyFile'> = promisify(
  fs.copyFile
);

export const stat: $PropertyType<FSPromise, 'stat'> = promisify(fs.stat);

export const readdir: $PropertyType<FSPromise, 'readdir'> = promisify(
  fs.readdir
);

export const unlink: $PropertyType<FSPromise, 'unlink'> = promisify(fs.unlink);

const _realpath = promisify(fs.realpath);

export async function realpath(originalPath: string): Promise<string> {
  try {
    return _realpath(originalPath, 'utf8');
  } catch (e) {
    // do nothing
  }

  return originalPath;
}

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

export const ncp: (
  source: FilePath,
  destination: FilePath,
  options?: NcpOptions
) => void = promisify(_ncp);

export function writeFileStream(
  filePath: FilePath,
  stream: Readable
): Promise<number> {
  return new Promise((resolve, reject) => {
    let fsStream = fs.createWriteStream(filePath);
    stream
      .pipe(fsStream)
      // $FlowFixMe
      .on('finish', () => resolve(fsStream.bytesWritten))
      .on('error', reject);
  });
}
