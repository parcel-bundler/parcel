// @flow

import path from 'path';
import {Worker} from 'worker_threads';
import * as napi from '@parcel/rust';
import type {FileSystem} from '@parcel/types';

export type ParcelV3Options = {|
  threads?: number,
  nodeWorkers?: number,
  fs?: FileSystem,
|};

export type ParcelV3BuildOptions = {||};

export class ParcelV3 {
  _internal: napi.ParcelNapi;

  constructor({threads, nodeWorkers, fs}: ParcelV3Options) {
    this._internal = new napi.ParcelNapi({
      threads,
      nodeWorkers,
      fs,
    });
  }

  async build(options: ParcelV3BuildOptions): Promise<any> {
    const workers = [];

    for (let i = 0; i < this._internal.nodeWorkerCount; i++) {
      workers.push(new Worker(path.join(__dirname, 'worker', 'index.js')));
    }

    let result = await this._internal.build(options);

    for (const worker of workers) worker.terminate();
    return result;
  }
}
