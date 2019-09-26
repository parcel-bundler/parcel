// @flow

import {Reporter} from '@parcel/plugin';
import invariant from 'assert';
import Server from './Server';
import path from 'path';

let servers: Map<number, Server> = new Map();
export default new Reporter({
  async report(event, options) {
    let serve = options.serve;
    if (!serve) return;

    let server = servers.get(serve.port);
    switch (event.type) {
      case 'watchStart': {
        // If there's already a server when watching has just started, something
        // is wrong.
        invariant(server == null);

        let serverOptions = {
          ...serve,
          projectRoot: options.projectRoot,
          cacheDir: options.cacheDir,
          distDir: path.join(options.cacheDir, 'dist'),
          // Override the target's publicUrl as that is likely meant for production.
          // This could be configurable in the future.
          publicUrl: serve.publicUrl ?? '/',
          inputFS: options.inputFS,
          outputFS: options.outputFS
        };

        server = new Server(serverOptions);
        servers.set(serverOptions.port, server);
        await server.start();

        break;
      }
      case 'watchEnd':
        invariant(server != null);
        await server.stop();
        servers.delete(serve.port);
        break;
      case 'buildSuccess':
        invariant(server != null);
        server.buildSuccess(event.bundleGraph);
        break;
      case 'buildFailure':
        invariant(server != null);
        server.buildError(event.error);
        break;
    }
  }
});
