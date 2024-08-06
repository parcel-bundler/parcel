// @flow
import * as nodejs_module from 'module';
import * as napi from '@parcel/rust';
import {workerData} from 'worker_threads';
import {ResolverNapi} from '../plugins/Resolver';
import {jsCallable} from '../jsCallable';

type LoadResolverOptions = {|
  resolveFrom: string,
  specifier: string,
|};

export class ParcelWorker {
  #resolvers: Map<string, ResolverNapi>;

  constructor() {
    this.#resolvers = new Map();
  }

  ping: () => Error | string = jsCallable(() => {
    return 'pong';
  });

  loadResolver: (options: LoadResolverOptions) => Error | string = jsCallable(
    ({specifier, resolveFrom}) => {
      const nodejs_require = nodejs_module.createRequire(resolveFrom);
      const filepath = nodejs_require.resolve(specifier);
      this.#resolvers.set(filepath, new ResolverNapi());
      console.log({filepath});
      return filepath;
    },
  );
}

napi.registerWorker(workerData.tx_worker, new ParcelWorker());
