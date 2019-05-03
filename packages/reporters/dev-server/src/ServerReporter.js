// @flow
import {Reporter} from '@parcel/plugin';
import Server from './Server';

let servers: Map<number, Server> = new Map();
export default new Reporter({
  async report(event, options) {
    let serve = options.serve;
    if (!serve) return;

    let target = options.targets[0];

    let serverOptions = {
      ...serve,
      cacheDir: options.cacheDir,
      distDir: target.distDir,
      // Override the target's publicUrl as that is likely meant for production.
      // This could be configurable in the future.
      publicUrl: serve.publicUrl != null ? serve.publicUrl : '/'
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
