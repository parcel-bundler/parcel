// @flow strict-local

import type {CacheBackend, FilePath} from '@parcel/types';

import invariant from 'assert';
import {PassThrough, Readable} from 'stream';
import {deserialize, serialize, registerSerializableClass} from '@parcel/utils';
// $FlowFixMe this is untyped
import packageJson from '../package.json';
import {FSCache} from './FSCache';

export * from './FSCache';
export * from './HTTPCache';

type SerializedCache = {|
  backends: Array<Buffer>
|};

export default class Cache {
  backends: Array<CacheBackend>;

  constructor(backends: Array<CacheBackend>) {
    this.backends = backends;
  }

  serialize(): SerializedCache {
    return {
      backends: this.backends.map(b => serialize(b))
    };
  }

  static deserialize(opts: SerializedCache) {
    return new Cache(opts.backends.map(b => deserialize(b)));
  }

  async getStream(key: string): Promise<Readable> {
    let missing = [];
    for (let backend of this.backends) {
      if (await backend.blobExists(key)) {
        let backendStream = await backend.getStream(key);
        let stream = new PassThrough();
        backendStream.pipe(stream);
        for (let miss of missing) {
          if (miss.writable) {
            let passThrough = new PassThrough();
            backendStream.pipe(passThrough);
            miss.setStream(key, passThrough);
          }
        }

        return stream;
      } else {
        missing.push(backend);
      }
    }

    throw new Error('Missing stream');
  }

  // TODO: Uses of this should probably not be using the cache. Remove this.
  _getCachePath(cacheId: string, extension: string = '.v8'): FilePath {
    return require('path').join('/tmp/parcelcachepath', cacheId, extension);
  }

  async setStream(key: string, stream: Readable): Promise<string> {
    // Create PassThrough streams and pipe the origin stream through them to
    // the destinations, sending data from the origin to multiple destinations.
    // https://stackoverflow.com/questions/19553837/node-js-piping-the-same-readable-stream-into-multiple-writable-targets
    await Promise.all(
      this.backends.map(backend => {
        if (!backend.writable) {
          return Promise.resolve();
        }

        let passThrough = new PassThrough();
        stream.pipe(passThrough);
        return backend.setStream(key, passThrough);
      })
    );
    return key;
  }

  async blobExists(key: string): Promise<boolean> {
    for (let backend of this.backends) {
      if (await backend.blobExists(key)) {
        return true;
      }
    }

    return false;
  }

  async get(key: string) {
    let missing = [];
    for (let backend of this.backends) {
      let value = await backend.get(key);
      if (value !== null) {
        await Promise.all(missing.map(b => b.set(key, value)));
        return value;
      } else {
        missing.push(backend);
      }
    }
  }

  async set(key: string, value: mixed) {
    await Promise.all(
      this.backends.map(b =>
        b.writable ? b.set(key, value) : Promise.resolve()
      )
    );
  }
}

registerSerializableClass(`${packageJson.version}:Cache`, Cache);
