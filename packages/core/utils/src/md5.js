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

export const envCache = new Map<Object, string>();

export function md5FromOrderedObject(
  obj: {+[string]: mixed, ...},
  encoding: StringHashEncoding = 'hex',
): string {
  // {
  //   filePath: assetGroup.filePath,
  //   env: assetGroup.env.id,
  //   isSource: assetGroup.isSource,
  //   sideEffects: assetGroup.sideEffects,
  //   code: assetGroup.code,
  //   pipeline: assetGroup.pipeline,
  //   query: assetGroup.query ? objectSortedEntries(assetGroup.query) : null,
  //   invalidations: assetGroup.invalidations,
  // }

  // maybe envCache can be Map<GenericObj, string> instead of Map<everythingExceptID, envID>

  for (const entry of envCache.entries()) {
    // entry: [Environment, id]
    if (deepEqual(entry[0], obj)) {
      console.log('getting the following from md5 cache', entry[1]);
      return entry[1];
    }
  }

  let value = md5FromString(JSON.stringify(obj), encoding);

  envCache.set(obj, value);
  return value;
}

function deepEqual(object1, object2) {
  const keys1 = Object.keys(object1);
  const keys2 = Object.keys(object2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    const val1 = object1[key];
    const val2 = object2[key];

    const areObjects = isObject(val1) && isObject(val2);
    if (
      (areObjects && !deepEqual(val1, val2)) ||
      (!areObjects && val1 !== val2)
    ) {
      return false;
    }
  }

  return true;
}

function isObject(object) {
  return object != null && typeof object === 'object';
}

export function md5FromObject(
  obj: {+[string]: mixed, ...},
  encoding: StringHashEncoding = 'hex',
): string {
  for (const entry of envCache.entries()) {
    // entry: [Environment, id]
    if (deepEqual(entry[0], obj)) {
      console.log('getting the following from md5 cache', entry[1]);
      return entry[1];
    }
  }

  let value = md5FromString(JSON.stringify(obj), encoding);

  envCache.set(obj, value);
  return value;
}

export function md5FromFilePath(
  fs: FileSystem,
  filePath: string,
): Promise<string> {
  return md5FromReadableStream(fs.createReadStream(filePath));
}
