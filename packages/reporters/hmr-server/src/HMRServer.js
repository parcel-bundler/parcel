// @flow

import type {BuildSuccessEvent} from '@parcel/types';
import type {PrintableError} from '@parcel/utils';
import type {Server, ServerError, HMRServerOptions} from './types';

import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import ansiHtml from 'ansi-html';
import {getCertificate, generateCertificate} from '@parcel/utils';
import logger from '@parcel/logger';
import {prettyError} from '@parcel/utils';
import {md5FromObject} from '@parcel/utils';

type HMRAsset = {|
  id: string,
  type: string,
  output: string,
  envHash: string,
  deps: Object
|};

type HMRError = {|
  message: string,
  stack?: string
|};

type HMRMessage = {|
  type: string,
  ansiError?: HMRError,
  htmlError?: HMRError,
  assets?: Array<HMRAsset>
|};

export default class HMRServer {
  server: Server;
  wss: WebSocket.Server;
  unresolvedError: HMRMessage | null = null;
  options: HMRServerOptions;

  constructor(options: HMRServerOptions) {
    this.options = options;
  }

  async start() {
    await new Promise(async resolve => {
      if (!this.options.https) {
        this.server = http.createServer();
      } else if (this.options.https === true) {
        this.server = https.createServer(
          await generateCertificate(this.options.cacheDir)
        );
      } else {
        this.server = https.createServer(
          await getCertificate(this.options.https)
        );
      }

      let websocketOptions = {
        server: this.server
        /*verifyClient: info => {
          if (!this.options.host) return true;

          let originator = new URL(info.origin);
          return this.options.host === originator.hostname;
        }*/
      };

      this.wss = new WebSocket.Server(websocketOptions);
      this.server.listen(this.options.port, this.options.host, resolve);
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
      ansiError: {
        message,
        stack
      },
      htmlError: {
        message: ansiHtml(message),
        stack: ansiHtml(stack)
      }
    };

    this.broadcast(this.unresolvedError);
  }

  async emitUpdate(event: BuildSuccessEvent) {
    this.unresolvedError = null;

    let changedAssets = Array.from(event.changedAssets.values()).filter(
      asset => asset.env.context === 'browser'
    );

    if (changedAssets.length === 0) return;

    let assets = await Promise.all(
      changedAssets.map(async asset => {
        let dependencies = event.assetGraph.getDependencies(asset);
        let deps = {};
        for (let dep of dependencies) {
          let resolved = event.assetGraph.getDependencyResolution(dep);
          if (resolved) {
            deps[dep.moduleSpecifier] = resolved.id;
          }
        }

        return {
          id: asset.id,
          type: asset.type,
          output: await asset.getCode(),
          envHash: md5FromObject(asset.env),
          deps
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
