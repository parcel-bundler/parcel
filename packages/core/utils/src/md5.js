// @flow strict-local

import invariant from 'assert';
import crypto from 'crypto';
import fs from 'fs';

type StringHashEncoding = 'hex' | 'latin1' | 'binary' | 'base64';

export function md5FromString(
  string: string,
  encoding: StringHashEncoding = 'hex'
): string {
  return crypto
    .createHash('md5')
    .update(string)
    .digest(encoding);
}

export function md5FromFilePath(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
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
