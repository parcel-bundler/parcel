// @flow

import type {BuildSuccessEvent, PluginOptions} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';
import type {AnsiDiagnosticResult} from '@parcel/utils';
import type {ServerError, HMRServerOptions} from './types.js.flow';

import WebSocket from 'ws';
import {md5FromObject, prettyDiagnostic, ansiHtml} from '@parcel/utils';

type HMRAsset = {|
  id: string,
  type: string,
  output: string,
  envHash: string,
  depsByBundle: {[string]: {[string]: string, ...}, ...},
|};

type HMRMessage =
  | {|
      type: 'update',
      assets: Array<HMRAsset>,
    |}
  | {|
      type: 'error',
      diagnostics: {|
        ansi: Array<AnsiDiagnosticResult>,
        html: Array<AnsiDiagnosticResult>,
      |},
    |};

export default class HMRServer {
  wss: WebSocket.Server;
  unresolvedError: HMRMessage | null = null;
  options: HMRServerOptions;

  constructor(options: HMRServerOptions) {
    this.options = options;
  }

  start() {
    let websocketOptions = {
      /*verifyClient: info => {
          if (!this.options.host) return true;

          let originator = new URL(info.origin);
          return this.options.host === originator.hostname;
        }*/
    };
    if (this.options.devServer) {
      websocketOptions.server = this.options.devServer;
    } else if (this.options.port) {
      websocketOptions.port = this.options.port;
    }
    this.wss = new WebSocket.Server(websocketOptions);

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
  }

  async emitError(options: PluginOptions, diagnostics: Array<Diagnostic>) {
    let renderedDiagnostics = await Promise.all(
      diagnostics.map(d => prettyDiagnostic(d, options)),
    );

    // store the most recent error so we can notify new connections
    // and so we can broadcast when the error is resolved
    this.unresolvedError = {
      type: 'error',
      diagnostics: {
        ansi: renderedDiagnostics,
        html: renderedDiagnostics.map(d => {
          return {
            message: ansiHtml(d.message),
            stack: ansiHtml(d.stack),
            codeframe: ansiHtml(d.codeframe),
            hints: d.hints.map(hint => ansiHtml(hint)),
          };
        }),
      },
    };

    this.broadcast(this.unresolvedError);
  }

  async emitUpdate(event: BuildSuccessEvent) {
    this.unresolvedError = null;

    let changedAssets = Array.from(event.changedAssets.values());
    if (changedAssets.length === 0) return;

    let assets = await Promise.all(
      changedAssets.map(async asset => {
        let dependencies = event.bundleGraph.getDependencies(asset);
        let depsByBundle = {};
        for (let bundle of event.bundleGraph.findBundlesWithAsset(asset)) {
          let deps = {};
          for (let dep of dependencies) {
            let resolved = event.bundleGraph.getDependencyResolution(
              dep,
              bundle,
            );
            if (resolved) {
              deps[dep.moduleSpecifier] = resolved.id;
            }
          }
          depsByBundle[bundle.id] = deps;
        }

        return {
          id: asset.id,
          type: asset.type,
          output: await asset.getCode(),
          envHash: md5FromObject(asset.env),
          depsByBundle,
        };
      }),
    );

    this.broadcast({
      type: 'update',
      assets: assets,
    });
  }

  handleSocketError(err: ServerError) {
    if (err.code === 'ECONNRESET') {
      // This gets triggered on page refresh, ignore this
      return;
    }

    this.options.logger.warn({
      origin: '@parcel/reporter-dev-server',
      message: `[${err.code}]: ${err.message}`,
      stack: err.stack,
    });
  }

  broadcast(msg: HMRMessage) {
    const json = JSON.stringify(msg);
    for (let ws of this.wss.clients) {
      ws.send(json);
    }
  }
}
