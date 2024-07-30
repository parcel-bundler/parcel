// @flow
import * as napi from '@parcel/rust';
import {workerData} from 'worker_threads';
import type {ResolverNapi} from '../plugins/Resolver';

export class ParcelWorker {
  #resolvers: Map<string, ResolverNapi>;

  ping() {
    // console.log('Hi');
  }
}

napi.registerWorker(workerData.tx_worker, new ParcelWorker());
