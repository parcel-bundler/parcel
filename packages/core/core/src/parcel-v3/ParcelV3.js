// @flow

import path from 'path';
import {Worker} from 'worker_threads';
import {ParcelNapi, type ParcelNapiOptions} from '@parcel/rust';

export type ParcelV3Options = {|
  fs?: ParcelNapiOptions['fs'],
  nodeWorkers?: number,
  packageManager?: ParcelNapiOptions['packageManager'],
  threads?: number,
  tracerOptions?: ParcelNapiOptions['tracerOptions'],
  ...ParcelNapiOptions['options'],
|};

export class ParcelV3 {
  _internal: ParcelNapi;

  constructor({
    fs,
    nodeWorkers,
    packageManager,
    threads,
    tracerOptions,
    ...options
  }: ParcelV3Options) {
    this._internal = new ParcelNapi({
      fs,
      nodeWorkers,
      packageManager,
      threads,
      options,
      tracerOptions,
      // {
      //   mode: 'file',
      //   directory: path.join(process.cwd(), 'logs'),
      //   prefix: '',
      //   maxFiles: 100,
      // },
    });
  }

  async build(): Promise<any> {
    const workers = [];

    for (let i = 0; i < this._internal.nodeWorkerCount; i++) {
      workers.push(new Worker(path.join(__dirname, 'worker', 'index.js')));
    }

    let result = await this._internal.build();

    for (const worker of workers) worker.terminate();
    return result;
  }
}
