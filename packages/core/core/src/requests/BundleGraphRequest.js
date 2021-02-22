// @flow strict-local

import type {
  Async,
  Bundle as IBundle,
  Namer,
  ConfigOutput,
} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type ParcelConfig, {LoadedPlugin} from '../ParcelConfig';
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
import {unique, md5FromOrderedObject} from '@parcel/utils';
import PluginOptions from '../public/PluginOptions';
import applyRuntimes from '../applyRuntimes';
import {PARCEL_VERSION} from '../constants';
import {optionsProxy} from '../utils';
import createParcelConfigRequest, {
  getCachedParcelConfig,
} from './ParcelConfigRequest';
import {
  createDevDependency,
  getDevDepRequests,
  invalidateDevDeps,
  runDevDepRequest,
} from './DevDepRequest';

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
        await input.api.runRequest<null, ConfigAndCachePath>(
          createParcelConfigRequest(),
        ),
      );
      let parcelConfig = getCachedParcelConfig(configResult, input.options);

      let {devDeps, invalidDevDeps} = await getDevDepRequests(input.api);
      invalidateDevDeps(invalidDevDeps, input.options, parcelConfig);

      let builder = new BundlerRunner(input, parcelConfig, devDeps);
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
  devDeps: Map<string, string>;

  constructor(
    {input, api, options}: RunInput,
    config: ParcelConfig,
    devDeps: Map<string, string>,
  ) {
    this.options = options;
    this.api = api;
    this.optionsRef = input.optionsRef;
    this.config = config;
    this.devDeps = devDeps;
    this.pluginOptions = new PluginOptions(
      optionsProxy(this.options, api.invalidateOnOptionChange),
    );
  }

  async bundle(graph: AssetGraph): Promise<InternalBundleGraph> {
    report({
      type: 'buildProgress',
      phase: 'bundling',
    });

    let plugin = await this.config.getBundler();
    let {plugin: bundler, name, resolveFrom} = plugin;
    let devDepRequest = await createDevDependency(
      {
        moduleSpecifier: name,
        resolveFrom,
      },
      plugin,
      this.devDeps,
      this.options,
    );
    await runDevDepRequest(this.api, devDepRequest);

    let configResult: ?ConfigOutput;
    if (bundler.loadConfig != null) {
      try {
        configResult = await nullthrows(bundler.loadConfig)({
          options: this.pluginOptions,
          logger: new PluginLogger({origin: this.config.getBundlerName()}),
        });
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, {
            origin: this.config.getBundlerName(),
          }),
        });
      }
    }

    if (configResult != null) {
      for (let file of configResult.files) {
        this.api.invalidateOnFileUpdate(file.filePath);
        this.api.invalidateOnFileDelete(file.filePath);
      }
    }

    let cacheKey = await this.getCacheKey(graph, configResult);

    // Check if the cacheKey matches the one already stored in the graph.
    // This can save time deserializing from cache if the graph is already in memory.
    let previousResult = await this.api.getPreviousResult(cacheKey);
    if (previousResult != null) {
      this.api.storeResult(previousResult, cacheKey);
      return previousResult;
    }

    // Otherwise, check the cache in case the cache key has already been written to disk.
    if (!this.options.shouldDisableCache) {
      let cached = await this.options.cache.get(cacheKey);
      if (cached != null) {
        this.api.storeResult(cached, cacheKey);
        return cached;
      }
    }

    let internalBundleGraph = InternalBundleGraph.fromAssetGraph(graph);
    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'before_bundle');
    let mutableBundleGraph = new MutableBundleGraph(
      internalBundleGraph,
      this.options,
    );

    let logger = new PluginLogger({origin: this.config.getBundlerName()});

    try {
      await bundler.bundle({
        bundleGraph: mutableBundleGraph,
        config: configResult?.config,
        options: this.pluginOptions,
        logger,
      });
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, {
          origin: this.config.getBundlerName(),
        }),
      });
    }

    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_bundle');
    if (this.pluginOptions.mode === 'production') {
      try {
        await bundler.optimize({
          bundleGraph: mutableBundleGraph,
          config: configResult?.config,
          options: this.pluginOptions,
          logger,
        });
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, {
            origin: this.config.getBundlerName(),
          }),
        });
      }

      // $FlowFixMe
      await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_optimize');
    }

    await this.nameBundles(internalBundleGraph);

    await applyRuntimes({
      bundleGraph: internalBundleGraph,
      api: this.api,
      config: this.config,
      options: this.options,
      optionsRef: this.optionsRef,
      pluginOptions: this.pluginOptions,
      devDeps: this.devDeps,
    });

    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_runtimes');

    this.api.storeResult(internalBundleGraph, cacheKey);
    return internalBundleGraph;
  }

  getCacheKey(assetGraph: AssetGraph, configResult: ?ConfigOutput): string {
    return md5FromOrderedObject({
      parcelVersion: PARCEL_VERSION,
      hash: assetGraph.getHash(),
      config: configResult?.config,
    });
  }

  async nameBundles(bundleGraph: InternalBundleGraph): Promise<void> {
    let namers = await this.config.getNamers();
    let bundles = bundleGraph.getBundles();

    for (let namer of namers) {
      let devDepRequest = await createDevDependency(
        {
          moduleSpecifier: namer.name,
          resolveFrom: namer.resolveFrom,
        },
        namer,
        this.devDeps,
        this.options,
      );
      await runDevDepRequest(this.api, devDepRequest);
    }

    await Promise.all(
      bundles.map(bundle => this.nameBundle(namers, bundle, bundleGraph)),
    );

    let bundleNames = bundles.map(b =>
      path.join(b.target.distDir, nullthrows(b.name)),
    );
    assert.deepEqual(
      bundleNames,
      unique(bundleNames),
      'Bundles must have unique names',
    );
  }

  async nameBundle(
    namers: Array<LoadedPlugin<Namer>>,
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
          diagnostic: errorToDiagnostic(e, {
            origin: namer.name,
          }),
        });
      }
    }

    throw new Error('Unable to name bundle');
  }
}
