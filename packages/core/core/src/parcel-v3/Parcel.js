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
  #fs: FileSystem | void;

  constructor({
    threads = napi.ParcelNapi.defaultThreadCount(),
    nodeWorkers,
    fs,
  }: ParcelV3Options) {
    this.#nodeWorkerCount = nodeWorkers || threads;
    this.#fs = fs;
    this._internal = new napi.ParcelNapi({
      threads,
      nodeWorkers,
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
      case 1:
        if (!this.#fs) throw new Error('FS Unset');
        return this.#fs.readFileSync(data, 'utf8');
      case 2:
        if (!this.#fs) throw new Error('FS Unset');
        return this.#fs.statSync(data).isFile();
      case 3:
        if (!this.#fs) throw new Error('FS Unset');
        return this.#fs.statSync(data).isDirectory();
      default:
        throw new Error('Unknown message');
    }
  }

  async build(): Promise<any> {
    // initialize workers lazily
    const workers = this.#startWorkers();

    // Run the Parcel build
    let result = await this._internal.build();

    // Stop workers
    this.#stopWorkers(await workers);
    return result;
  }

  async #startWorkers() {
    const workersOnLoad = [];
    const workers = [];

    for (let i = 0; i < this.#nodeWorkerCount; i++) {
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
