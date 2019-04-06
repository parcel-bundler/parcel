// @flow
import type {BuildSuccessEvent} from '@parcel/types';
import type {PrintableError} from '@parcel/reporter-cli/src/prettyError';
import type {Server, ServerError, HMRServerOptions} from './types.js.flow';
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import generateCertificate from '@parcel/utils/src/generateCertificate';
import getCertificate from '@parcel/utils/src/getCertificate';
import logger from '@parcel/logger';
import prettyError from '@parcel/reporter-cli/src/prettyError';

type HMRAsset = {|
  id: string,
  type: string,
  output: string,
  deps: Object
|};

type HMRError = {|
  message: string,
  stack?: string
|};

type HMRMessage = {|
  type: string,
  error?: HMRError,
  assets?: Array<HMRAsset>
|};

export default class HMRServer {
  server: Server;
  wss: WebSocket.Server;
  unresolvedError: HMRMessage | null = null;

  async start(options: HMRServerOptions) {
    await new Promise(async resolve => {
      if (!options.https) {
        this.server = http.createServer();
      } else if (options.https === true) {
        this.server = https.createServer(
          await generateCertificate(options.cacheDir)
        );
      } else {
        this.server = https.createServer(await getCertificate(options.https));
      }

      let websocketOptions = {
        server: this.server,
        verifyClient: info => {
          if (!options.host) return true;

          let originator = new URL(info.origin);
          return options.host === originator.hostname;
        }
      };

      this.wss = new WebSocket.Server(websocketOptions);
      this.server.listen(options.port, resolve);
    });

    this.wss.on('connection', ws => {
      ws.onerror = this.handleSocketError;

      if (this.unresolvedError) {
        ws.send(JSON.stringify(this.unresolvedError));
      }
    });

    this.wss.on('error', this.handleSocketError);

    return this.wss._server.address().port;
  }

  stop() {
    this.wss.close();
    this.server.close();
  }

  emitError(err: PrintableError) {
    let {message, stack} = prettyError(err);

    // store the most recent error so we can notify new connections
    // and so we can broadcast when the error is resolved
    this.unresolvedError = {
      type: 'error',
      error: {
        message,
        stack
      }
    };

    this.broadcast(this.unresolvedError);
  }

  async emitUpdate(event: BuildSuccessEvent) {
    if (this.unresolvedError) {
      this.unresolvedError = null;
      this.broadcast({
        type: 'error-resolved'
      });

      return;
    }

    let assets = await Promise.all(
      Array.from(event.changedAssets.values()).map(async asset => {
        let deps = {};
        for (let dependency of asset.dependencies) {
          // ? SourcePath should come from graph?
          deps[dependency.sourcePath] = dependency.id;
        }

        let output = await asset.getOutput();

        return {
          id: asset.id,
          type: asset.type,
          output: output.code,
          deps: deps
        };
      })
    );

    this.broadcast({
      type: 'update',
      assets: assets
    });
  }

  handleSocketError(err: ServerError) {
    if (err.code === 'ECONNRESET') {
      // This gets triggered on page refresh, ignore this
      return;
    }

    logger.warn(err);
  }

  broadcast(msg: HMRMessage) {
    const json = JSON.stringify(msg);
    for (let ws of this.wss.clients) {
      ws.send(json);
    }
  }
}
