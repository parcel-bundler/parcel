// @flow
import * as napi from '@atlaspack/rust';
import {workerData} from 'worker_threads';
import type {ResolverNapi} from '../plugins/Resolver';

export class AtlaspackWorker {
  #resolvers: Map<string, ResolverNapi>;

  ping() {
    // console.log('Hi');
  }
}

napi.registerWorker(workerData.tx_worker, new AtlaspackWorker());
