// @flow
import * as napi from '@parcel/rust';
import type {ResolverNapi} from '../plugins/Resolver';

export class ParcelWorker {
  #resolvers: Map<string, ResolverNapi>;

  ping() {
    // console.log('Hi');
  }
}

napi.registerWorker(new ParcelWorker());
