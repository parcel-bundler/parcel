// @flow

import path from 'path';
import {Worker} from 'worker_threads';
import {AtlaspackNapi, type AtlaspackNapiOptions} from '@atlaspack/rust';

const WORKER_PATH = path.join(__dirname, 'worker', 'index.js');

export type AtlaspackV3Options = {|
  fs?: AtlaspackNapiOptions['fs'],
  nodeWorkers?: number,
  packageManager?: AtlaspackNapiOptions['packageManager'],
  threads?: number,
  ...AtlaspackNapiOptions['options'],
|};

export class AtlaspackV3 {
  _internal: AtlaspackNapi;

  constructor({
    fs,
    nodeWorkers,
    packageManager,
    threads,
    ...options
  }: AtlaspackV3Options) {
    this._internal = new AtlaspackNapi({
      fs,
      nodeWorkers,
      packageManager,
      threads,
      options,
    });
  }

  async build(): Promise<any> {
    const [workers, registerWorker] = this.#createWorkers();

    let result = await this._internal.build({
      registerWorker,
    });

    for (const worker of workers) worker.terminate();
    return result;
  }

  async buildAssetGraph(): Promise<any> {
    const [workers, registerWorker] = this.#createWorkers();

    let result = await this._internal.buildAssetGraph({
      registerWorker,
    });

    for (const worker of workers) worker.terminate();
    return result;
  }

  #createWorkers() {
    const workers = [];

    return [
      workers,
      tx_worker => {
        let worker = new Worker(WORKER_PATH, {
          workerData: {
            tx_worker,
          },
        });
        workers.push(worker);
      },
    ];
  }
}
