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
      rpc: async (err, id, data, done) => {
        try {
          if (err) {
            done({Err: err});
            return;
          }
          done({Ok: (await this.#on_event(id, data)) ?? undefined});
        } catch (error) {
          done({Err: error});
          return;
        }
      },
    });
  }

  // eslint-disable-next-line no-unused-vars
  #on_event(id, data: any) {
    switch (id) {
      // Ping
      case 0:
        return;
      default:
        throw new Error('Unknown message');
    }
  }

  async build(options: ParcelV3BuildOptions): Promise<any> {
    // initialize workers lazily
    const workers = this.#startWorkers();

    // Run the Parcel build
    let result = await this._internal.build(options);

    // Stop workers
    this.#stopWorkers(await workers);
    return result;
  }

  async #startWorkers() {
    const workersOnLoad = [];
    const workers = [];

    for (let i = 0; i < this._internal.nodeWorkerCount; i++) {
      let worker = new Worker(path.join(__dirname, 'worker', 'index.js'));
      workers.push(worker);
      workersOnLoad.push(
        new Promise(resolve => worker.once('message', resolve)),
      );
    }

    await Promise.all(workersOnLoad);
    return workers;
  }

  #stopWorkers(workers) {
    for (const worker of workers) {
      worker.terminate();
    }
  }
}
