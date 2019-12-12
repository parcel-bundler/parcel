// @flow
import type {HMRServerOptions} from './types.js.flow';

import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import HMRServer from './HMRServer';

let servers: Map<number, HMRServer> = new Map();
export default new Reporter({
  async report({event, options, logger}) {
    let hot = options.hot;
    if (!hot) return;

    let hmrOptions: HMRServerOptions = {
      ...hot,
      cacheDir: options.cacheDir,
      inputFS: options.inputFS,
      outputFS: options.outputFS,
      logger,
    };

    let server = servers.get(hmrOptions.port);
    switch (event.type) {
      case 'watchStart': {
        invariant(server == null);

        server = new HMRServer(hmrOptions);
        servers.set(hmrOptions.port, server);
        await server.start();
        break;
      }
      case 'watchEnd':
        invariant(server != null);
        await server.stop();
        servers.delete(hmrOptions.port);
        break;
      case 'buildSuccess':
        invariant(server != null);
        server.emitUpdate(event);
        break;
      case 'buildFailure':
        invariant(server != null);
        server.emitError(event.diagnostics);
        break;
    }
  },
});
