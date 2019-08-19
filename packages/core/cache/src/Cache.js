// @flow strict-local

import type {CacheBackend, FilePath} from '@parcel/types';

import invariant from 'assert';
import {PassThrough, Readable} from 'stream';
import {deserialize, serialize, registerSerializableClass} from '@parcel/utils';
// $FlowFixMe this is untyped
import packageJson from '../package.json';
import {FSCache} from './FSCache';

export * from './FSCache';

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

  getStream(key: string): Readable {
    return new SerialGetStream(this.backends.map(b => () => b.getStream(key)));
  }

  // TODO: Uses of this should probably not be using the cache. Remove this.
  _getCachePath(cacheId: string, extension: string = '.v8'): FilePath {
    let fsCache = this.backends.find(b => b instanceof FSCache);
    invariant(fsCache instanceof FSCache);
    return fsCache._getCachePath(cacheId, extension);
  }

  async setStream(key: string, stream: Readable): Promise<string> {
    // Create PassThrough streams and pipe the origin stream through them to
    // the destinations, sending data from the origin to multiple destinations.
    // https://stackoverflow.com/questions/19553837/node-js-piping-the-same-readable-stream-into-multiple-writable-targets
    await Promise.all(
      this.backends.map(backend => {
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
    for (let backend of this.backends) {
      let value = await backend.get(key);
      if (value !== undefined) {
        return value;
      }
    }
  }

  async set(key: string, value: mixed) {
    await Promise.all(this.backends.map(b => b.set(key, value)));
  }
}

type StreamGetter = () => Readable;
class SerialGetStream extends Readable {
  _currentStream: Readable;
  _currentStreamIndex: number = 0;
  _streamGetters: Array<StreamGetter>;

  constructor(streamGetters: Array<StreamGetter>) {
    super();
    if (streamGetters.length < 1) {
      throw new TypeError('Requires at least one stream getter');
    }
    this._streamGetters = streamGetters;
    this._subscribeToNextStream();
  }

  _subscribeToNextStream() {
    let currentStreamGetter = this._streamGetters[this._currentStreamIndex++];
    if (currentStreamGetter == null) {
      this.destroy();
      return;
    }

    this._currentStream = currentStreamGetter();
    this._currentStream.on('error', (error: Error) => {
      // If the error occurs before the first byte has been read (the stream
      // has never emitted any data), destroy it and move onto the next stream.
      // e.g. reading a stream from cache can fs.createReadStream locally on disk,
      //      and fall back to a remote stream.
      // $FlowFixMe
      if (this.bytesRead > 0) {
        this.destroy(error);
      } else {
        this._subscribeToNextStream();
      }
    });
    this._currentStream.on('readable', () => {
      this.push(this._currentStream.read());
    });
    this._currentStream.on('end', () => {
      this.destroy();
    });
  }

  _read() {
    // _read must be implemented.
  }
}

registerSerializableClass(`${packageJson.version}:Cache`, Cache);
