// @flow
import {Reporter} from '@parcel/plugin';
import Server from './Server';

let server: Server | null = null;
export default new Reporter({
  async report(event, options) {
    if (!options.serve) return;

    if (!server) {
      if (options.serve === true) {
        options.serve = {
          host: '',
          port: 1234,
          https: false,
          certificateDir: '.parcel-cert'
        };
      }

      let serverOptions = {
        host: options.serve.host,
        port: options.serve.port,
        https: options.serve.https,
        certificateDir: options.serve.certificateDir,
        distDir: 'dist', //options.distDir, // ! Not sure how this works now
        publicUrl: options.publicUrl || '/'
      };

      // $FlowFixMe
      server = new Server(serverOptions);
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
