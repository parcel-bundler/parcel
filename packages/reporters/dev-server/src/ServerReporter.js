// @flow
import {Reporter} from '@parcel/plugin';
import Server from './Server';

const DEFAULT_CACHE_DIR = '.parcel-cache';

let servers: Map<number, Server> = new Map();
export default new Reporter({
  async report(event, options) {
    if (!options.serve) return;

    let serverOptions = {
      ...options.serve,
      cacheDir: options.cacheDir || DEFAULT_CACHE_DIR,
      distDir: 'dist', //options.distDir, // ! Not sure how this works now
      publicUrl: options.publicUrl || '/'
    };

    let server = servers.get(serverOptions.port);
    if (!server) {
      server = new Server(serverOptions);
      servers.set(serverOptions.port, server);
      await server.start();
    }

    if (event.type === 'buildSuccess') {
      server.buildSuccess(event.bundleGraph);
    }

    if (event.type === 'buildFailure') {
      server.buildError(event.error);
    }
  }
});
