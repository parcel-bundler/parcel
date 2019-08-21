// @flow strict-local

import type {Readable} from 'stream';

import type {CacheBackend, FilePath} from '@parcel/types';
import {
  bufferStream,
  serialize,
  deserialize,
  registerSerializableClass,
  urlJoin
} from '@parcel/utils';
// $FlowFixMe this is untyped
import packageJson from '../package.json';
// $FlowFixMe this is untyped
import request from 'got';

type HTTPOpts = {|
  uri: string,
  writable?: boolean
|};

export class HTTPCache implements CacheBackend {
  uri: string;
  writable: boolean;

  constructor(opts: HTTPOpts) {
    this.uri = opts.uri;
    this.writable = opts.writable ?? false;
  }

  _getCachePath(cacheId: string, extension: string = '.v8'): FilePath {
    return urlJoin(this.uri, cacheId.slice(0, 2), cacheId.slice(2) + extension);
  }

  getStream(key: string): Readable {
    return request
      .get(this._getCachePath(key, '.blob'), {stream: true})
      .on('response', response => {
        if (response.statusCode >= 400) {
          throw new Error('Not found');
        }
      });
  }

  async setStream(key: string, stream: Readable): Promise<string> {
    await request.put(this._getCachePath(key, '.blob'), {
      body: await bufferStream(stream)
    });
    return key;
  }

  async blobExists(key: string): Promise<boolean> {
    try {
      await request.head(this._getCachePath(key, '.blob'));
      return true;
    } catch (e) {
      return false;
    }
  }

  async get(key: string) {
    let response;
    try {
      response = await request.get(this._getCachePath(key), {
        encoding: null
      });
    } catch (e) {
      if (e.name === 'HTTPError') {
        // TODO: Log 500+ verbosely?
        return null;
      } else {
        throw e;
      }
    }

    return deserialize(response.body);
  }

  async set(key: string, value: mixed) {
    try {
      await request.put(this._getCachePath(key), {
        body: serialize(value),
        headers: {
          'content-type': 'application/octet-stream'
        }
      });
    } catch (e) {
      if (e.name === 'HTTPError') {
        // TODO: Log 500+ verbosely?
        return null;
      } else {
        throw e;
      }
    }
    return key;
  }
}

registerSerializableClass(`${packageJson.version}:HTTPCache`, HTTPCache);
