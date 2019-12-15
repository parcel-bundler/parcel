// @flow
import type {HMRServerOptions} from './types.js.flow';

import {devServer} from '@parcel/reporter-dev-server';
import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import HMRServer from './HMRServer';

let server: HMRServer | null = null;
export default new Reporter({
  async report({event, options, logger}) {
    let hot = options.hot;
    if (!hot) return;

    if (devServer == null) {
      throw new Error(
        `@parcel/reporter-dev-server is required and should appear before @parcel/reporter-hmr-server`,
      );
    }

    let hmrOptions: HMRServerOptions = {
      devServer,
      logger,
    };

    switch (event.type) {
      case 'watchStart': {
        invariant(server == null);

        server = new HMRServer(hmrOptions);
        await server.start();
        break;
      }
      case 'watchEnd':
        invariant(server != null);
        await server.stop();
        server = null;
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
