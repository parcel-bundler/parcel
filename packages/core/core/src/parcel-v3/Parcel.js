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

export class ParcelV3 {
  _internal: napi.ParcelNapi;
  #nodeWorkerCount: number;

  constructor({
    threads = napi.ParcelNapi.defaultThreadCount(),
    nodeWorkers,
  }: ParcelV3Options) {
    this.#nodeWorkerCount = nodeWorkers || threads;
    this._internal = new napi.ParcelNapi({
      threads,
      nodeWorkers,
      // eslint-disable-next-line no-unused-vars
      rpc: async (err, id, data, done) => {
        if (err) {
          done({Err: err});
          return;
        }
        try {
          done({Ok: (await this.#on_event(id, data)) ?? undefined});
        } catch (error) {
          done({Err: error});
        }
      },
    });
  }

  // eslint-disable-next-line no-unused-vars
  #on_event(id, data: any) {
    switch (id) {
      // Ping
      case 0:
        return undefined;
      // Start workers
      case 1:
        return undefined;
      default:
        throw new Error('Unknown message');
    }
  }

  async build(): Promise<any> {
    const workers = await this.#startWorkers();
    let result = await this._internal.build();
    this.#stopWorkers(workers);
    return result;
  }

  async #startWorkers() {
    const workers = [];

    for (let i = 0; i < this.#nodeWorkerCount; i++) {
      let worker = new Worker(path.join(__dirname, 'worker', 'index.js'));
      await new Promise(resolve => worker.once('message', resolve));
      workers.push(worker);
    }

    return workers;
  }

  #stopWorkers(workers) {
    for (const worker of workers) {
      worker.terminate();
    }
  }
}
