// @flow strict-local

// import type {Blob} from '@parcel/types';
import type {Readable} from 'stream';

import invariant from 'assert';
import crypto from 'crypto';
import fs from 'fs';

type StringHashEncoding = 'hex' | 'latin1' | 'binary' | 'base64';

export function md5FromString(
  string: string | Buffer,
  encoding: StringHashEncoding = 'hex'
): string {
  return crypto
    .createHash('md5')
    .update(string)
    .digest(encoding);
}

export function md5FromReadableStream(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    stream
      .pipe(crypto.createHash('md5').setEncoding('hex'))
      .on('finish', function() {
        resolve(this.read());
      })
      .on('error', reject);
  });
}

function isObject(a) {
  return Object.prototype.toString.call(a) === '[object Object]';
}

function sortObject<T>(object: T): T {
  if (isObject(object)) {
    invariant(typeof object === 'object' && object != null);
    let newObj = {};
    let keysSorted = Object.keys(object).sort();
    for (let key of keysSorted) {
      newObj[key] = sortObject(object[key]);
    }
    // $FlowFixMe
    return newObj;
  } else if (Array.isArray(object)) {
    return object.map(sortObject);
  } else {
    return object;
  }
}

export function md5FromObject(
  obj: {[string]: mixed},
  encoding: StringHashEncoding = 'hex'
): string {
  return md5FromString(JSON.stringify(sortObject(obj)), encoding);
}

export function md5FromFilePath(filePath: string): Promise<string> {
  return md5FromReadableStream(fs.createReadStream(filePath));
}

export function md5FromBlob(blob: string | Buffer | Readable) {
  if (typeof blob === 'string' || blob instanceof Buffer) {
    return md5FromString(blob);
  }

  return md5FromReadableStream(blob);
}
