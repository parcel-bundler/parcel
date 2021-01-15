// @flow strict-local

import type {Readable} from 'stream';
import type {FileSystem} from '@parcel/fs';

import crypto from 'crypto';
import {objectSortedEntriesDeep} from './collection';

type StringHashEncoding = 'hex' | 'latin1' | 'binary' | 'base64';

export function md5FromString(
  string: string | Buffer,
  encoding: StringHashEncoding = 'hex',
): string {
  return crypto
    .createHash('md5')
    .update(string)
    .digest(encoding);
}

export function md5FromReadableStream(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    stream.on('error', err => {
      reject(err);
    });
    stream
      .pipe(crypto.createHash('md5').setEncoding('hex'))
      .on('finish', function() {
        resolve(this.read());
      })
      .on('error', err => {
        reject(err);
      });
  });
}

export function md5FromOrderedObject(
  obj: {+[string]: mixed, ...},
  encoding: StringHashEncoding = 'hex',
): string {
  return md5FromString(JSON.stringify(obj), encoding);
}

export function md5FromObject(
  obj: {+[string]: mixed, ...},
  encoding: StringHashEncoding = 'hex',
): string {
  return md5FromString(JSON.stringify(objectSortedEntriesDeep(obj)), encoding);
}

export function md5FromFilePath(
  fs: FileSystem,
  filePath: string,
): Promise<string> {
  return md5FromReadableStream(fs.createReadStream(filePath));
}
