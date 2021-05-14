// @flow strict-local

import type {Bundle as IBundle, Namer} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type ParcelConfig, {LoadedPlugin} from '../ParcelConfig';
import type {StaticRunOpts, RunAPI} from '../RequestTracker';
import type {
  Asset,
  Bundle as InternalBundle,
  Config,
  ContentKey,
  DevDepRequest,
  ParcelOptions,
} from '../types';
import type {ConfigAndCachePath} from './ParcelConfigRequest';

import invariant from 'assert';
import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import AssetGraph, {nodeFromAsset} from '../AssetGraph';
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
import {getInvalidationHash} from '../assetUtils';
import {createConfig} from '../InternalConfig';
import {
  loadPluginConfig,
  runConfigRequest,
  getConfigHash,
  type PluginWithLoadConfig,
} from './ConfigRequest';
import {cacheSerializedObject, deserializeToCache} from '../serializer';

type BundleGraphRequestInput = {|
  assetGraph: AssetGraph,
  optionsRef: SharedReference,
  changedAssets: Map<string, Asset>,
  previousAssetGraphHash: ?string,
  assetGraphTransformationSubGraph: AssetGraph,
  shouldBundle: boolean,
|};

type BundleGraphRequestResult = {|
  bundleGraph: InternalBundleGraph,
  changedBundles: Set<ContentKey>,
  bundlerHash: string,
|};

type RunInput = {|
  input: BundleGraphRequestInput,
  ...StaticRunOpts,
|};

type BundleGraphRequest = {|
  id: string,
  +type: 'bundle_graph_request',
  run: RunInput => Promise<BundleGraphRequestResult>,
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
      //if flag and subgraphs then update instead of bundle
      return builder.bundle({
        graph: input.input.assetGraph,
        previousAssetGraphHash: input.input.previousAssetGraphHash,
        assetGraphTransformationSubGraph:
          input.input.assetGraphTransformationSubGraph,
        changedAssets: input.input.changedAssets,
        shouldBundle: input.input.shouldBundle,
      });
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
  previousDevDeps: Map<string, string>;
  devDepRequests: Map<string, DevDepRequest>;
  configs: Map<string, Config>;

  constructor(
    {input, api, options}: RunInput,
    config: ParcelConfig,
    previousDevDeps: Map<string, string>,
  ) {
    this.options = options;
    this.api = api;
    this.optionsRef = input.optionsRef;
    this.config = config;
    this.previousDevDeps = previousDevDeps;
    this.devDepRequests = new Map();
    this.configs = new Map();
    this.pluginOptions = new PluginOptions(
      optionsProxy(this.options, api.invalidateOnOptionChange),
    );
  }

  async loadConfigs() {
    // Load all configs up front so we can use them in the cache key
    let bundler = await this.config.getBundler();
    await this.loadConfig(bundler);

    let namers = await this.config.getNamers();
    for (let namer of namers) {
      await this.loadConfig(namer);
    }

    let runtimes = await this.config.getRuntimes();
    for (let runtime of runtimes) {
      await this.loadConfig(runtime);
    }
  }

  async loadConfig<T: PluginWithLoadConfig>(plugin: LoadedPlugin<T>) {
    let config = createConfig({
      plugin: plugin.name,
      searchPath: path.join(this.options.projectRoot, 'index'),
    });

    await loadPluginConfig(plugin, config, this.options);
    await runConfigRequest(this.api, config);
    for (let devDep of config.devDeps) {
      let devDepRequest = await createDevDependency(
        devDep,
        plugin,
        this.previousDevDeps,
        this.options,
      );
      await this.runDevDepRequest(devDepRequest);
    }

    this.configs.set(plugin.name, config);
  }

  async runDevDepRequest(devDepRequest: DevDepRequest) {
    let {moduleSpecifier, resolveFrom} = devDepRequest;
    let key = `${moduleSpecifier}:${resolveFrom}`;
    this.devDepRequests.set(key, devDepRequest);
    await runDevDepRequest(this.api, devDepRequest);
  }

  async bundle({
    graph,
    previousAssetGraphHash,
    assetGraphTransformationSubGraph,
    changedAssets,
    shouldBundle,
  }: {|
    graph: AssetGraph,
    previousAssetGraphHash: ?string,
    assetGraphTransformationSubGraph: AssetGraph,
    changedAssets: Map<string, Asset>,
    shouldBundle: boolean,
  |}): Promise<BundleGraphRequestResult> {
    report({
      type: 'buildProgress',
      phase: 'bundling',
    });
    let mutableShouldBundle = shouldBundle;

    await this.loadConfigs();

    let plugin = await await this.config.getBundler();
    let {plugin: bundler, name, resolveFrom} = plugin;
    let bundlerHash = this.getBundlerHash();

    let cacheKey = await this.getCacheKey(graph);

    // Check if the cacheKey matches the one already stored in the graph.
    // This can save time deserializing from cache if the graph is already in memory.
    // This will only happen in watch mode. In this case, serialization will occur once
    // when sending the bundle graph to workers, and again on shutdown when writing to cache.
    let previousResult = await this.api.getPreviousResult(cacheKey);
    if (previousResult != null) {
      // No need to call api.storeResult here because it's already the request result.
      return previousResult;
    }

    // Otherwise, check the cache in case the cache key has already been written to disk.
    if (!this.options.shouldDisableCache) {
      let cached = await this.options.cache.getBuffer(cacheKey);
      if (cached != null) {
        // Deserialize, and store the original buffer in an in memory cache so we avoid
        // re-serializing it when sending to workers, and in build mode, when writing to cache on shutdown.
        let graph = deserializeToCache(cached);
        this.api.storeResult(graph, cacheKey);
        return graph;
      }
    }

    let changedBundles = new Set<ContentKey>();
    // if cache is disabled, should this even happen?
    let cachedBundleGraph: ?BundleGraphRequestResult;
    if (
      !mutableShouldBundle &&
      previousAssetGraphHash != null &&
      this.pluginOptions.mode !== 'production'
    ) {
      cachedBundleGraph = await this.api.getRequestResult<BundleGraphRequestResult>(
        'BundleGraph:' + previousAssetGraphHash,
      );

      // should re-bundle if using a different bundle from previously
      if (cachedBundleGraph?.bundlerHash !== bundlerHash) {
        mutableShouldBundle = true;
      }
    }

    let logger = new PluginLogger({origin: this.config.getBundlerName()});

    let internalBundleGraph: InternalBundleGraph;
    let mutableBundleGraph;
    try {
      if (!mutableShouldBundle && cachedBundleGraph?.bundleGraph != null) {
        internalBundleGraph = cachedBundleGraph.bundleGraph;
        await dumpGraphToGraphViz(internalBundleGraph._graph, 'before_bundle');

        // if no changes to the dependency structure, we invalidate the bundle.
        // when the bundle hash is invalidated, the bundle graph will re-hash for packaging
        for (let asset of changedAssets.values()) {
          internalBundleGraph._graph.addNodeByContentKey(
            asset.id,
            nodeFromAsset(asset),
          );
          let bundles = internalBundleGraph.findBundlesWithAsset(asset);

          for (let bundle of bundles) {
            internalBundleGraph._bundleContentHashes.delete(bundle.id);
            changedBundles.add(bundle.id);
          }
        }
        mutableBundleGraph = new MutableBundleGraph(
          internalBundleGraph,
          this.options,
        );
      }
      //inc flag should be enabled
      else if (assetGraphTransformationSubGraph.nodes.size > 1) {
        //If there are no transformations, a root node will still exist
        //probably want old bundlegraph as well
        let internalBundleGraphChunks = InternalBundleGraph.fromAssetGraph(
          assetGraphTransformationSubGraph,
        );

        let mutableBundleGraphChunks = new MutableBundleGraph(
          internalBundleGraphChunks,
          this.options,
        );

        //** for debugging purposes so no errors occur, will be removed */
        internalBundleGraph = InternalBundleGraph.fromAssetGraph(graph);

        mutableBundleGraph = new MutableBundleGraph(
          internalBundleGraph,
          this.options,
        );
        await bundler.bundle({
          bundleGraph: mutableBundleGraph,
          config: this.configs.get(plugin.name)?.result,
          options: this.pluginOptions,
          logger,
        });
      } else {
        internalBundleGraph = InternalBundleGraph.fromAssetGraph(graph);

        mutableBundleGraph = new MutableBundleGraph(
          internalBundleGraph,
          this.options,
        );
        await bundler.bundle({
          bundleGraph: mutableBundleGraph,
          config: this.configs.get(plugin.name)?.result,
          options: this.pluginOptions,
          logger,
        });
      }
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, {
          origin: this.config.getBundlerName(),
        }),
      });
    } finally {
      invariant(internalBundleGraph != null);
      await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_bundle');
    }

    if (this.pluginOptions.mode === 'production') {
      try {
        await bundler.optimize({
          bundleGraph: mutableBundleGraph,
          config: this.configs.get(plugin.name)?.result,
          options: this.pluginOptions,
          logger,
        });
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, {
            origin: this.config.getBundlerName(),
          }),
        });
      } finally {
        await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_optimize');
      }
    }

    // Add dev dependency for the bundler. This must be done AFTER running it due to
    // the potential for lazy require() that aren't executed until the request runs.
    let devDepRequest = await createDevDependency(
      {
        moduleSpecifier: name,
        resolveFrom,
      },
      plugin,
      this.previousDevDeps,
      this.options,
    );
    await this.runDevDepRequest(devDepRequest);

    await this.nameBundles(internalBundleGraph);

    await applyRuntimes({
      bundleGraph: internalBundleGraph,
      api: this.api,
      config: this.config,
      options: this.options,
      optionsRef: this.optionsRef,
      pluginOptions: this.pluginOptions,
      previousDevDeps: this.previousDevDeps,
      devDepRequests: this.devDepRequests,
      configs: this.configs,
    });
    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_runtimes');

    // Store the serialized bundle graph in an in memory cache so that we avoid serializing it
    // many times to send to each worker, and in build mode, when writing to cache on shutdown.
    cacheSerializedObject(internalBundleGraph);

    // Recompute the cache key to account for new dev dependencies and invalidations.
    cacheKey = await this.getCacheKey(graph);

    let result = {
      bundleGraph: internalBundleGraph,
      changedBundles,
      bundlerHash,
    };
    this.api.storeResult(result, cacheKey);
    return result;
  }

  getBundlerHash(): string {
    return md5FromOrderedObject({
      bundlerName: this.config.getBundlerName(),
      config: this.configs.get(this.config.getBundlerName())?.result,
    });
  }

  async getCacheKey(assetGraph: AssetGraph): Promise<string> {
    return md5FromOrderedObject({
      parcelVersion: PARCEL_VERSION,
      hash: assetGraph.getHash(),
      configs: [...this.configs].map(([pluginName, config]) =>
        getConfigHash(config, pluginName, this.options),
      ),
      devDepRequests: [...this.devDepRequests.values()].map(d => d.hash),
      invalidations: await getInvalidationHash(
        this.api.getInvalidations(),
        this.options,
      ),
    });
  }

  async nameBundles(bundleGraph: InternalBundleGraph): Promise<void> {
    let namers = await this.config.getNamers();
    let bundles = bundleGraph.getBundles();
    await Promise.all(
      bundles.map(bundle => this.nameBundle(namers, bundle, bundleGraph)),
    );

    // Add dev deps for namers, AFTER running them to account for lazy require().
    for (let namer of namers) {
      let devDepRequest = await createDevDependency(
        {
          moduleSpecifier: namer.name,
          resolveFrom: namer.resolveFrom,
        },
        namer,
        this.previousDevDeps,
        this.options,
      );
      await this.runDevDepRequest(devDepRequest);
    }

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
          config: this.configs.get(namer.name)?.result,
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
