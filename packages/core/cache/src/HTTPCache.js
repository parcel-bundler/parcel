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
import got from 'got';
import URL from 'url';

type HTTPOpts = {|
  uri: string,
  writable?: boolean,
  timeout?: number,
  retries?: number
|};

export class HTTPCache implements CacheBackend {
  uri: string;
  writable: boolean;
  timeout: number;
  retries: number;
  // $FlowFixMe
  request: (uri: string, gotOptions: Object) => any;

  constructor(opts: HTTPOpts) {
    this.uri = opts.uri;
    this.writable = opts.writable ?? false;
    this.request = async (uri, gotOptions) => {
      try {
        return await got(uri, {
          timeout: opts.timeout ?? 25000,
          retries: opts.retries ?? 2,
          ...gotOptions
        });
      } catch (e) {
        if (e.code === 'ETIMEDOUT') {
          let {protocol, host} = URL.parse(uri);
          throw new Error(
            `Timed out trying to connect to ${URL.format({protocol, host})}.`
          );
        }

        throw e;
      }
    };
  }

  serialize() {
    return {
      uri: this.uri,
      writable: this.writable,
      timeout: this.timeout,
      retries: this.retries
    };
  }

  static deserialize(opts: HTTPOpts) {
    return new HTTPCache(opts);
  }

  _getCachePath(cacheId: string, extension: string = '.v8'): FilePath {
    return urlJoin(this.uri, cacheId.slice(0, 2), cacheId.slice(2) + extension);
  }

  getStream(key: string): Readable {
    return this.request(this._getCachePath(key, '.blob'), {
      stream: true,
      method: 'get'
    });
  }

  async setStream(key: string, stream: Readable): Promise<string> {
    await this.request(this._getCachePath(key, '.blob'), {
      method: 'put',
      body: await bufferStream(stream)
    });
    return key;
  }

  async blobExists(key: string): Promise<boolean> {
    try {
      await this.request(this._getCachePath(key, '.blob'), {method: 'head'});
      return true;
    } catch (e) {
      return false;
    }
  }

  async get(key: string) {
    let response;
    try {
      response = await this.request(this._getCachePath(key), {
        method: 'get',
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
    await this.request(this._getCachePath(key), {
      method: 'put',
      body: serialize(value),
      headers: {
        'content-type': 'application/octet-stream'
      }
    });
    return key;
  }
}

registerSerializableClass(`${packageJson.version}:HTTPCache`, HTTPCache);
