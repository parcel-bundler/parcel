// @flow

import path from 'path';
import {Worker} from 'worker_threads';
import * as napi from '@parcel/rust';
import type {FileSystem} from '@parcel/types';
import {RpcEventRouter} from './RpcEventRouter';
import type {HandlerFunc} from './RpcEventRouter';
import {FileSystemRpc} from './FileSystem';

type PingHandler = HandlerFunc<'ping', void, void>;

export type ParcelV3Options = {|
  threads?: number,
  nodeWorkers?: number,
  fs?: FileSystem,
|};

export type ParcelV3BuildOptions = {||};

export class ParcelV3 {
  _internal: napi.ParcelNapi;
  #nodeWorkerCount: number;

  constructor({threads, nodeWorkers, fs}: ParcelV3Options) {
    const rpc = new RpcEventRouter();

    if (fs) {
      new FileSystemRpc(rpc, fs);
    }

    this._internal = new napi.ParcelNapi({
      threads,
      nodeWorkers,
      useFileSystem: !!fs,
      rpc: rpc.callback,
    });

    rpc.on<PingHandler>('ping', () => {
      /* loopback */
    });
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
