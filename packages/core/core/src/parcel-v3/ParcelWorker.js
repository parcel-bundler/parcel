// @flow

import {parentPort} from 'worker_threads';
import * as napi from '@parcel/rust';
import {RpcEventRouter} from './RpcEventRouter';
import type {HandlerFunc} from './RpcEventRouter';

type PingHandler = HandlerFunc<'ping', void, void>;

export class ParcelWorker {
  constructor() {
    const rpc = new RpcEventRouter();
    napi.workerCallback(rpc.callback);

    rpc.on<PingHandler>('ping', () => {
      /* loopback */
    });

    parentPort?.postMessage(null);
  }
}
