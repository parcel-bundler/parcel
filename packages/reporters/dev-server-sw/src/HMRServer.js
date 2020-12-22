// @flow

import type {BuildSuccessEvent, PluginOptions} from '@parcel/types';
import type {Diagnostic} from '@parcel/diagnostic';
import type {AnsiDiagnosticResult} from '@parcel/utils';

import {
  ansiHtml,
  md5FromObject,
  prettyDiagnostic,
  PromiseQueue,
} from '@parcel/utils';

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

const FS_CONCURRENCY = 64;

export default class HMRServer {
  unresolvedError: HMRMessage | null = null;
  broadcast: HMRMessage => void;

  constructor(broadcast: HMRMessage => void) {
    this.broadcast = broadcast;
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

    let queue = new PromiseQueue({maxConcurrent: FS_CONCURRENCY});
    for (let asset of changedAssets) {
      queue.add(async () => {
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
              deps[dep.moduleSpecifier] = event.bundleGraph.getAssetPublicId(
                resolved,
              );
            }
          }
          depsByBundle[bundle.id] = deps;
        }

        return {
          id: event.bundleGraph.getAssetPublicId(asset),
          type: asset.type,
          output: await asset.getCode(),
          envHash: md5FromObject(asset.env),
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
}
