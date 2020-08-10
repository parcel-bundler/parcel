// @flow strict-local

import type {Readable} from 'stream';
import type {FileSystem} from '@parcel/fs';

import crypto from 'crypto';
import {objectSortedEntriesDeep} from './collection';
import baseX from 'base-x';

type StringHashEncoding = 'hex' | 'latin1' | 'binary' | 'base64' | 'base62';

export function md5FromString(
  string: string | Buffer,
  encoding: StringHashEncoding = 'hex',
): string {
  if (encoding === 'base62') {
    return bufferBase62(
      crypto
        .createHash('md5')
        .update(string)
        .digest(),
    );
  } else {
    return crypto
      .createHash('md5')
      .update(string)
      .digest(encoding);
  }
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

export function md5FromObject(
  obj: {+[string]: mixed, ...},
  encoding?: StringHashEncoding,
): string {
  return md5FromString(JSON.stringify(objectSortedEntriesDeep(obj)), encoding);
}

export function md5FromFilePath(
  fs: FileSystem,
  filePath: string,
): Promise<string> {
  return md5FromReadableStream(fs.createReadStream(filePath));
}

const base62 = baseX(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
);

export function bufferBase62(input: Buffer): string {
  return base62.encode(input);
}
