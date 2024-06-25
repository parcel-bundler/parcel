// @flow
import {parentPort} from 'worker_threads';
import * as napi from '@parcel/rust';
import type {ResolverNapi} from './plugins/Resolver';

export class ParcelWorker {
  #resolvers: Map<string, ResolverNapi>;

  registerResolver() {}
}

napi.registerWorker(new ParcelWorker(), () => parentPort?.postMessage(null));
