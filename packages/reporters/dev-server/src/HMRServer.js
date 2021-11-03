// @flow

import type {BuildSuccessEvent, Dependency, PluginOptions} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';
import type {AnsiDiagnosticResult} from '@parcel/utils';
import type {ServerError, HMRServerOptions} from './types.js.flow';

import WebSocket from 'ws';
import invariant from 'assert';
import {ansiHtml, prettyDiagnostic, PromiseQueue} from '@parcel/utils';

export type HMRAsset = {|
  id: string,
  type: string,
  output: string,
  envHash: string,
  depsByBundle: {[string]: {[string]: string, ...}, ...},
|};

export type HMRMessage =
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

const FS_CONCURRENCY = 64;

export default class HMRServer {
  wss: WebSocket.Server;
  unresolvedError: HMRMessage | null = null;
  options: HMRServerOptions;

  constructor(options: HMRServerOptions) {
    this.options = options;
  }

  start(): any {
    this.wss = new WebSocket.Server(
      this.options.devServer
        ? {server: this.options.devServer}
        : {port: this.options.port},
    );

    this.wss.on('connection', ws => {
      if (this.unresolvedError) {
        ws.send(JSON.stringify(this.unresolvedError));
      }
    });

    // $FlowFixMe[incompatible-exact]
    this.wss.on('error', err => this.handleSocketError(err));

    let address = this.wss.address();
    invariant(typeof address === 'object' && address != null);
    return address.port;
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
        html: renderedDiagnostics.map((d, i) => {
          return {
            message: ansiHtml(d.message),
            stack: ansiHtml(d.stack),
            codeframe: ansiHtml(d.codeframe),
            hints: d.hints.map(hint => ansiHtml(hint)),
            documentation: diagnostics[i].documentationURL ?? '',
          };
        }),
      },
    };

    this.broadcast(this.unresolvedError);
  }

  async emitUpdate(event: BuildSuccessEvent) {
    this.unresolvedError = null;

    let changedAssets = new Set(event.changedAssets.values());
    if (changedAssets.size === 0) return;

    let queue = new PromiseQueue({maxConcurrent: FS_CONCURRENCY});
    for (let asset of changedAssets) {
      if (asset.type !== 'js') {
        // If all of the incoming dependencies of the asset actually resolve to a JS asset
        // rather than the original, we can mark the runtimes as changed instead. URL runtimes
        // have a cache busting query param added with HMR enabled which will trigger a reload.
        let runtimes = new Set();
        let incomingDeps = event.bundleGraph.getIncomingDependencies(asset);
        let isOnlyReferencedByRuntimes = incomingDeps.every(dep => {
          let resolved = event.bundleGraph.getResolvedAsset(dep);
          let isRuntime = resolved?.type === 'js' && resolved !== asset;
          if (resolved && isRuntime) {
            runtimes.add(resolved);
          }
          return isRuntime;
        });

        if (isOnlyReferencedByRuntimes) {
          for (let runtime of runtimes) {
            changedAssets.add(runtime);
          }

          continue;
        }
      }

      queue.add(async () => {
        let dependencies = event.bundleGraph.getDependencies(asset);
        let depsByBundle = {};
        for (let bundle of event.bundleGraph.getBundlesWithAsset(asset)) {
          let deps = {};
          for (let dep of dependencies) {
            let resolved = event.bundleGraph.getResolvedAsset(dep, bundle);
            if (resolved) {
              deps[getSpecifier(dep)] =
                event.bundleGraph.getAssetPublicId(resolved);
            }
          }
          depsByBundle[bundle.id] = deps;
        }

        return {
          id: event.bundleGraph.getAssetPublicId(asset),
          type: asset.type,
          // No need to send the contents of non-JS assets to the client.
          output: asset.type === 'js' ? await asset.getCode() : '',
          envHash: asset.env.id,
          depsByBundle,
        };
      });
    }

    let assets = await queue.run();
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

function getSpecifier(dep: Dependency): string {
  if (typeof dep.meta.placeholder === 'string') {
    return dep.meta.placeholder;
  }

  return dep.specifier;
}
