// @flow
import type {HMRServerOptions} from './types.js.flow';

import {Reporter} from '@parcel/plugin';
import HMRServer from './HMRServer';

let hmrServer: HMRServer | null = null;
export default new Reporter({
  async report(event, options) {
    if (!options.hot) return;
    if (!options.cacheDir) {
      throw new Error('HMR Server cannot start without a defined cacheDir!');
    }

    if (!hmrServer) {
      hmrServer = new HMRServer();

      let hmrOptions: HMRServerOptions = {
        port: 0,
        cacheDir: options.cacheDir
      };

      await hmrServer.start(hmrOptions);
    }

    if (event.type === 'buildSuccess') {
      hmrServer.emitUpdate(event);
    }

    if (event.type === 'buildFailure') {
      hmrServer.emitError(event.error);
    }
  }
});
