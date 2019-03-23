// @flow
import type {ServerOptions, CacheEntry, Asset} from '@parcel/types';
import type {PrintableError} from '@parcel/reporter-cli/src/prettyError';
import type {Server, ServerError} from './types.js.flow';
import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import generateCertificate from '@parcel/server-utils/src/generateCertificate';
import getCertificate from '@parcel/server-utils/src/getCertificate';
import logger from '@parcel/logger';
import prettyError from '@parcel/reporter-cli/src/prettyError';

type HMRMessage = {|
  type: string,
  error?: {
    message: string,
    stack?: string
  },
  assets?: Array<{
    id: string,
    type: string,
    code: string,
    deps: Object
  }>
|};

export default class HMRServer {
  server: Server;
  wss: WebSocket.Server;
  unresolvedError: HMRMessage | null = null;
  changedAssets: Array<CacheEntry> = [];

  async start(options: ServerOptions) {
    await new Promise(async resolve => {
      if (!options.https) {
        this.server = http.createServer();
      } else if (typeof options.https === 'boolean') {
        this.server = https.createServer(generateCertificate(options));
      } else {
        this.server = https.createServer(await getCertificate(options.https));
      }

      let websocketOptions = {
        server: this.server,
        origin: options.host
          ? `${options.https ? 'https' : 'http'}://${options.host}`
          : undefined
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

  addChangedAsset(asset: CacheEntry) {
    this.changedAssets.push(asset);
  }

  emitUpdate(reload: boolean = false) {
    if (this.unresolvedError) {
      this.unresolvedError = null;
      this.broadcast({
        type: 'error-resolved'
      });

      return;
    }

    if (reload) {
      this.broadcast({
        type: 'reload'
      });
    } else {
      this.broadcast({
        type: 'update',
        assets: this.changedAssets.reduce((acc, cacheEntry) => {
          return [
            ...acc,
            ...cacheEntry.assets.map((asset: Asset) => {
              let deps = {};
              for (let dependency of asset.dependencies) {
                // ? SourcePath should come from graph?
                deps[dependency.sourcePath] = dependency.id;
              }

              return {
                id: asset.id,
                type: asset.type,
                code: asset.code, // ? This should probably be resolved from cache?
                deps: deps
              };
            })
          ];
        }, [])
      });
    }

    // TODO: Figure out how we'll let assets refresh browsers
    /*const shouldReload = this.changedAssets.some(asset => asset.hmrPageReload);*/

    this.changedAssets = [];
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
