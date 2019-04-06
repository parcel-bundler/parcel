// @flow
import type {HMRServerOptions} from './types.js.flow';

import {Reporter} from '@parcel/plugin';
import HMRServer from './HMRServer';

let hmrServer: HMRServer | null = null;
export default new Reporter({
  async report(event, options) {
    if (!options.hot) return;

    if (!hmrServer) {
      hmrServer = new HMRServer();

      let hmrOptions: HMRServerOptions = {
        port: 0,
        cacheDir: '.parcel-cert'
      };

      await hmrServer.start(hmrOptions);
    }

    if (event.type === 'buildProgress' && event.phase === 'transformFinished') {
      hmrServer.addChangedAsset(event.cacheEntry);
    }

    if (event.type === 'buildSuccess') {
      hmrServer.emitUpdate();
    }

    if (event.type === 'buildFailure') {
      hmrServer.emitError(event.error);
    }
  }
});
