// @flow
/* global globalThis:readonly */

import {Reporter} from '@parcel/plugin';
import HMRServer from './HMRServer';

let hmrServer;

export default (new Reporter({
  async report({event, options}) {
    let {hot} = options;
    switch (event.type) {
      case 'watchStart': {
        if (hot) {
          hmrServer = new HMRServer(data =>
            // $FlowFixMe
            globalThis.PARCEL_SERVICE_WORKER('hmrUpdate', data),
          );
        }
        break;
      }
      case 'watchEnd':
        break;
      case 'buildStart':
        break;
      case 'buildSuccess':
        {
          let files: {|[string]: string|} = {};
          for (let f of await options.outputFS.readdir('/app/dist')) {
            files[f] = await options.outputFS.readFile(
              '/app/dist/' + f,
              'utf8',
            );
          }
          // $FlowFixMe
          await globalThis.PARCEL_SERVICE_WORKER('setFS', files);
          if (hmrServer) {
            await hmrServer?.emitUpdate(event);
          }
        }
        break;
      case 'buildFailure':
        await hmrServer?.emitError(options, event.diagnostics);
        break;
    }
  },
}): Reporter);
