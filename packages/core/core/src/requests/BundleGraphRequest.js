// @flow strict-local

import type {AbortSignal} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import type {
  Async,
  Bundle as IBundle,
  Namer,
  FilePath,
  ConfigOutput,
} from '@parcel/types';
import type WorkerFarm, {SharedReference} from '@parcel/workers';
import type ParcelConfig from '../ParcelConfig';
import type {StaticRunOpts, RunAPI} from '../RequestTracker';
import type {Bundle as InternalBundle, ParcelOptions} from '../types';
import type {ConfigAndCachePath} from './ParcelConfigRequest';

import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import AssetGraph from '../AssetGraph';
import BundleGraph from '../public/BundleGraph';
import InternalBundleGraph from '../BundleGraph';
import MutableBundleGraph from '../public/MutableBundleGraph';
import {Bundle, NamedBundle} from '../public/Bundle';
import {report} from '../ReporterRunner';
import dumpGraphToGraphViz from '../dumpGraphToGraphViz';
import {normalizeSeparators, unique, md5FromOrderedObject} from '@parcel/utils';
import PluginOptions from '../public/PluginOptions';
import applyRuntimes from '../applyRuntimes';
import {PARCEL_VERSION} from '../constants';
import {assertSignalNotAborted, optionsProxy} from '../utils';
import createParcelConfigRequest, {
  getCachedParcelConfig,
} from './ParcelConfigRequest';

type BundleGraphRequestInput = {|
  assetGraph: AssetGraph,
  optionsRef: SharedReference,
|};

type RunInput = {|
  input: BundleGraphRequestInput,
  ...StaticRunOpts<InternalBundleGraph>,
|};

type BundleGraphRequest = {|
  id: string,
  +type: 'bundle_graph_request',
  run: RunInput => Async<InternalBundleGraph>,
  input: BundleGraphRequestInput,
|};

export default function createBundleGraphRequest(
  input: BundleGraphRequestInput,
): BundleGraphRequest {
  return {
    type: 'bundle_graph_request',
    id: 'BundleGraph:' + input.assetGraph.getHash(),
    run: async input => {
      let configResult = nullthrows(
        await input.api.runRequest<null, ConfigAndCachePath>(createParcelConfigRequest()),
      );
      let parcelConfig = getCachedParcelConfig(configResult, input.options);

      let builder = new BundlerRunner(input, parcelConfig);
      return builder.bundle(input.input.assetGraph);
    },
    input,
  };
}

class BundlerRunner {
  options: ParcelOptions;
  optionsRef: SharedReference;
  config: ParcelConfig;
  pluginOptions: PluginOptions;
  api: RunAPI;

  constructor({input, prevResult, api, options}: RunInput, config: ParcelConfig) {
    this.options = options;
    this.api = api;
    this.optionsRef = input.optionsRef;
    this.config = config;
    this.pluginOptions = new PluginOptions(
      this.options
    );
  }

  async bundle(
    graph: AssetGraph,
  ): Promise<InternalBundleGraph> {
    report({
      type: 'buildProgress',
      phase: 'bundling',
    });

    let {plugin: bundler} = await this.config.getBundler();

    let configResult: ?ConfigOutput;
    if (bundler.loadConfig != null) {
      try {
        configResult = await nullthrows(bundler.loadConfig)({
          options: this.pluginOptions,
          logger: new PluginLogger({origin: this.config.getBundlerName()}),
        });

        // TODO: add invalidations once bundling is a request
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, this.config.getBundlerName()),
        });
      }
    }

    // let cacheKey;
    // if (
    //   !this.options.disableCache// &&
    //   // !this.api.hasInvalidRequests()
    // ) {
      let cacheKey = await this.getCacheKey(graph, configResult);
    //   let cachedBundleGraphBuffer;
    //   try {
    //     cachedBundleGraphBuffer = await this.options.cache.getBlob(cacheKey);
    //   } catch {
    //     // Cache miss
    //   }

    //   if (cachedBundleGraphBuffer) {
    //     return [deserialize(cachedBundleGraphBuffer), cachedBundleGraphBuffer];
    //   }
    // }

    let internalBundleGraph = InternalBundleGraph.fromAssetGraph(graph);
    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'before_bundle');
    let mutableBundleGraph = new MutableBundleGraph(
      internalBundleGraph,
      this.options,
    );

    try {
      await bundler.bundle({
        bundleGraph: mutableBundleGraph,
        config: configResult?.config,
        options: this.pluginOptions,
        logger: new PluginLogger({origin: this.config.getBundlerName()}),
      });
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, this.config.getBundlerName()),
      });
    }

    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_bundle');
    try {
      await bundler.optimize({
        bundleGraph: mutableBundleGraph,
        config: configResult?.config,
        options: this.pluginOptions,
        logger: new PluginLogger({origin: this.config.getBundlerName()}),
      });
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, this.config.getBundlerName()),
      });
    }

    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_optimize');
    await this.nameBundles(internalBundleGraph);

    await applyRuntimes({
      bundleGraph: internalBundleGraph,
      api: this.api,
      config: this.config,
      options: this.options,
      optionsRef: this.optionsRef,
      pluginOptions: this.pluginOptions,
    });
    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_runtimes');
    
    // let serializedBundleGraph = serialize(internalBundleGraph);
    this.api.storeResult(
      internalBundleGraph,
      cacheKey,
    );

    return internalBundleGraph;
  }

  async getCacheKey(
    assetGraph: AssetGraph,
    configResult: ?ConfigOutput,
  ): Promise<string> {
    let name = this.config.getBundlerName();
    let {version} = await this.config.getBundler();

    return md5FromOrderedObject({
      parcelVersion: PARCEL_VERSION,
      name,
      version,
      hash: assetGraph.getHash(),
      config: configResult?.config,
    });
  }

  async nameBundles(bundleGraph: InternalBundleGraph): Promise<void> {
    let namers = await this.config.getNamers();
    let bundles = bundleGraph.getBundles();

    await Promise.all(
      bundles.map(bundle => this.nameBundle(namers, bundle, bundleGraph)),
    );

    let bundleNames = bundles.map(b => path.join(b.target.distDir, nullthrows(b.name)));
    assert.deepEqual(
      bundleNames,
      unique(bundleNames),
      'Bundles must have unique names',
    );
  }

  async nameBundle(
    namers: Array<{|
      name: string,
      version: string,
      plugin: Namer,
      resolveFrom: FilePath,
      keyPath: string,
    |}>,
    internalBundle: InternalBundle,
    internalBundleGraph: InternalBundleGraph,
  ): Promise<void> {
    let bundle = Bundle.get(internalBundle, internalBundleGraph, this.options);
    let bundleGraph = new BundleGraph<IBundle>(
      internalBundleGraph,
      NamedBundle.get,
      this.options,
    );

    for (let namer of namers) {
      try {
        let name = await namer.plugin.name({
          bundle,
          bundleGraph,
          options: this.pluginOptions,
          logger: new PluginLogger({origin: namer.name}),
        });

        if (name != null) {
          if (path.extname(name).slice(1) !== bundle.type) {
            throw new Error(
              `Destination name ${name} extension does not match bundle type "${bundle.type}"`,
            );
          }

          internalBundle.name = name;
          let {hashReference} = internalBundle;
          internalBundle.displayName = name.includes(hashReference)
            ? name.replace(hashReference, '[hash]')
            : name;

          return;
        }
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, namer.name),
        });
      }
    }

    throw new Error('Unable to name bundle');
  }
}
