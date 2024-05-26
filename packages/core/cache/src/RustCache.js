// @flow strict-local

import {serialize, deserialize, registerSerializableClass} from '@parcel/core';
// flowlint-next-line untyped-import:off
import packageJson from '../package.json';
import {RustCache as NativeRustCache} from '@parcel/rust';
import { bufferStream, readableFromStringOrBuffer } from "@parcel/utils";

export class RustCache extends NativeRustCache {
  get<T>(key: string): Promise<?T> {
    return deserialize(super.getBlob(key))
  }

  set(key: string, value: mixed): Promise<void> {
    super.setBlob(key, serialize(value));
  }

  setBlob(key, value: Buffer | string): Promise<void> {
    let val = typeof value === 'string' ? Buffer.from(value) : value;
    super.setBlob(key, val);
  }

  async setStream(key, stream: stream$Readable): Promise<void> {
    let buffer = await bufferStream(stream);
    this.setBlob(key, buffer);
  }

  getStream(key): stream$Readable {
    let value = this.getBlob(key);
    return readableFromStringOrBuffer(value);
  }

  refresh() {}

  hasLargeBlob() {
    return false;
  }

  setLargeBlob() {}
}

registerSerializableClass(`${packageJson.version}:RustCache`, RustCache);
