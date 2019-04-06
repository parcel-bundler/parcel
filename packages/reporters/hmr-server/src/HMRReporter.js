// @flow
import type {HMRServerOptions} from './types.js.flow';

import {Reporter} from '@parcel/plugin';
import HMRServer from './HMRServer';

const DEFAULT_CACHE_DIR = '.parcel-cache';

let hmrServer: HMRServer | null = null;
export default new Reporter({
  async report(event, options) {
    if (!options.hot) return;

    if (!hmrServer) {
      let hmrOptions: HMRServerOptions = {
        ...options.hot,
        cacheDir: options.cacheDir || DEFAULT_CACHE_DIR
      };

      hmrServer = new HMRServer(hmrOptions);
      await hmrServer.start();
    }

    if (event.type === 'buildSuccess') {
      hmrServer.emitUpdate(event);
    }

    if (event.type === 'buildFailure') {
      hmrServer.emitError(event.error);
    }
  }
});
