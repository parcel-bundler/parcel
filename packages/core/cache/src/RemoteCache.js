// @flow strict-local

/* eslint-env browser */

import type {Cache} from './types';

import {Readable} from 'stream';
import logger from '@parcel/logger';
import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
import {bufferStream} from '@parcel/utils';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';

export class RemoteCache implements Cache {
  baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async ensure(): Promise<void> {}

  _getCachePath(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  _get(key: string): Promise<Buffer> {
    return fetch(this._getCachePath(key)).then(async res => {
      if (res.ok) {
        return Buffer.from(await res.arrayBuffer());
      } else {
        throw res;
      }
    });
  }

  _set(key: string, data: Uint8Array | string): Promise<void> {
    return fetch(this._getCachePath(key), {
      method: 'POST',
      body: data,
    }).then(res => {
      if (!res.ok) {
        console.error(res);
        throw res;
      }
    });
  }

  _has(key: string): Promise<boolean> {
    return fetch(this._getCachePath(key), {
      method: 'HEAD',
    }).then(res => {
      if (res.status === 200) {
        return true;
      } else if (res.status === 404) {
        return false;
      } else {
        throw res;
      }
    });
  }

  getStream(key: string): Readable {
    let data = this._get(key);
    let stream = new Readable({
      // $FlowFixMe(incompatible-call)
      async read() {
        try {
          stream.push(await data);
          stream.push(null);
        } catch (e) {
          stream.emit('error', e);
        }
      },
    });
    return stream;
  }

  async setStream(key: string, stream: Readable): Promise<void> {
    let buf = await bufferStream(stream);
    return this._set(key, buf);
  }

  has(key: string): Promise<boolean> {
    return this._has(key);
  }

  getBlob(key: string): Promise<Buffer> {
    return this._get(key);
  }

  setBlob(key: string, contents: Buffer | string): Promise<void> {
    return this._set(key, contents);
  }

  async getBuffer(key: string): Promise<?Buffer> {
    try {
      return await this._get(key);
    } catch (err) {
      if (err.status === 404) {
        return null;
      } else {
        throw err;
      }
    }
  }

  hasLargeBlob(key: string): Promise<boolean> {
    return this._has(key);
  }

  getLargeBlob(key: string): Promise<Buffer> {
    return this._get(key);
  }

  setLargeBlob(key: string, contents: Buffer | string): Promise<void> {
    return this._set(key, contents);
  }

  async get<T>(key: string): Promise<?T> {
    try {
      let data = await this._get(key);
      return deserialize(data);
    } catch (err) {
      if (err.status === 404) {
        return null;
      } else {
        throw err;
      }
    }
  }

  async set(key: string, value: mixed): Promise<void> {
    try {
      let data = serialize(value);
      await this._set(key, data);
    } catch (err) {
      logger.error(err, '@parcel/cache');
    }
  }

  refresh() {}
}

registerSerializableClass(`${packageJson.version}:RemoteCache`, RemoteCache);
