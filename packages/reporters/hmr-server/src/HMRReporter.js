// @flow
import type {HMRServerOptions} from './types';

import {Reporter} from '@parcel/plugin';
import HMRServer from './HMRServer';

let servers: Map<number, HMRServer> = new Map();
export default new Reporter({
  async report(event, options) {
    let hot = options.hot;
    if (!hot) return;

    let hmrOptions: HMRServerOptions = {
      ...hot,
      cacheDir: options.cacheDir
    };

    let server = servers.get(hmrOptions.port);
    if (!server) {
      server = new HMRServer(hmrOptions);
      servers.set(hmrOptions.port, server);
      await server.start();
    }

    if (event.type === 'buildSuccess') {
      server.emitUpdate(event);
    }

    if (event.type === 'buildFailure') {
      server.emitError(event.error);
    }
  }
});
