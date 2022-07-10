// @flow strict-local

import type {Cache} from './types';
import type {Readable} from 'stream';

import {
  serialize,
  // prepareForSerialization,
  registerSerializableClass,
} from '@parcel/core';
import {blobToString, streamFromPromise} from '@parcel/utils';

// flowlint-next-line untyped-import:off
import packageJson from '../package.json';

// writes to the local cache are always synchronized to all workers
//
// Writes (batched write-through):
//  - are immediately written to the local cache and
//  - in Main thread: are batched/debounced and written to the remote cache
//  - in Workers: sent to the main thread
// Reads (cannot be batched)
//  - read from local, fallback to remote. store result in local cache

// type SerializedLayeredCache = {|
//   local: Cache,
//   remote: Cache,
//   batchSize: number,
//   handle: Handle,
// |};

// let i = 0;

export class LayeredCache implements Cache {
  local: Cache;
  remote: Cache;
  batchSize: number;
  _batch: Array<[string, Buffer | string]> = [];
  // handle: ?Handle;
  // farm: ?WorkerFarm;

  // #isWorker: boolean = false;

  constructor(
    local: Cache,
    remote: Cache,
    batchSize: number,
    // workerFarm: WorkerFarm | Handle,
  ) {
    this.remote = remote;
    this.local = local;
    this.batchSize = batchSize;
  }

  // static deserialize(opts: SerializedLayeredCache): LayeredCache {
  //   let cache = new LayeredCache(farm, opts.local, opts.remote, opts.batchSize);
  //   cache.#isWorker = true;
  //   return cache;
  // }

  // serialize(): SerializedLayeredCache {
  //   if (!this.handle) {
  //     this.handle = this.farm.createReverseHandle(
  //       (fn: string, args: Array<mixed>) => {
  //         // $FlowFixMe
  //         return this[fn](...args);
  //       },
  //     );
  //   }
  //   return {
  //     local: this.local,
  //     remote: this.remote,
  //     batchSize: this.batchSize,
  //     handle: this.handle,
  //   };
  // }

  // async flush(): Promise<void> {
  //   // let v = i++;
  //   // console.time('flush' + v);
  //   let batch = this._batch;
  //   this._batch = [];
  //   await this.remote.setBlobs(batch);
  //   // console.timeEnd('flush' + v);
  // }

  // async #addToBatch(key: string, value: Buffer | string) {
  //   // if (this.#isWorker) {
  //   // } else {
  //   this._batch.push([key, value]);
  //   if (this._batch.length > this.batchSize) {
  //     await this.flush();
  //   }
  //   // }
  // }

  async ensure(): Promise<void> {
    await Promise.all([this.local.ensure(), this.remote.ensure()]);
  }

  has(key: string): Promise<boolean> {
    return this.local.has(key) || this.remote.has(key);
  }

  async getBlob(key: string): Promise<Buffer> {
    let cachedValue = await this.local.getBuffer(key);
    if (cachedValue) return cachedValue;

    let remoteValue = await this.remote.getBlob(key);
    await this.local.setBlob(key, remoteValue);
    return remoteValue;
  }

  async getBuffer(key: string): Promise<?Buffer> {
    let cachedValue = await this.local.getBuffer(key);
    if (cachedValue) return cachedValue;

    let remoteValue = await this.remote.getBuffer(key);
    if (remoteValue) {
      await this.local.setBlob(key, remoteValue);
    }
    return remoteValue;
  }

  async get<T>(key: string): Promise<?T> {
    let cachedValue = await this.local.get(key);
    if (cachedValue) return cachedValue;

    let remoteValue = await this.remote.get(key);
    if (remoteValue) {
      await this.local.set(key, remoteValue);
    }
    return remoteValue;
  }

  getStream(key: string): Readable {
    return streamFromPromise(this.getBlob(key));
  }

  async setBlob(key: string, contents: Buffer | string): Promise<void> {
    await this.local.setBlob(key, contents);
    // await this.#addToBatch(key, contents);
  }
  async setStream(key: string, stream: Readable): Promise<void> {
    await this.setBlob(key, await blobToString(stream));
  }
  async set(key: string, value: mixed): Promise<void> {
    await this.setBlob(key, serialize(value));
  }

  async setBlobs(
    entries: $ReadOnlyArray<[string, Buffer | string]>,
  ): Promise<void> {
    for (let [key, value] of entries) {
      await this.setBlob(key, value);
    }
  }

  hasLargeBlob(key: string): Promise<boolean> {
    return this.has(key);
  }

  getLargeBlob(key: string): Promise<Buffer> {
    return this.getBlob(key);
  }

  setLargeBlob(key: string, contents: Buffer | string): Promise<void> {
    return this.setBlob(key, contents);
  }

  refresh(): void {
    // NOOP
  }
}

registerSerializableClass(`${packageJson.version}:LayeredCache`, LayeredCache);
