// @flow
import {Reporter} from '@parcel/plugin';
import HMRServer from './HMRServer';

let hmrServer: HMRServer | null = null;
export default new Reporter({
  async report(event, options) {
    if (options.hot) {
      if (!hmrServer) {
        hmrServer = new HMRServer();

        if (options.hot === true) {
          options.hot = {
            port: 0,
            certificateDir: '.parcel-cert'
          };
        }

        await hmrServer.start(options.hot);
      }

      if (
        event.type === 'buildProgress' &&
        event.phase === 'transformFinished'
      ) {
        hmrServer.addChangedAsset(event.cacheEntry);
      }

      if (event.type === 'buildSuccess') {
        hmrServer.emitUpdate();
      }

      if (event.type === 'buildFailure') {
        hmrServer.emitError(event.error);
      }
    }
  }
});
