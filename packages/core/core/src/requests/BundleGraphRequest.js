// @flow strict-local

import type {Async, Bundle as IBundle, Namer} from '@parcel/types';
import type {SharedReference} from '@parcel/workers';
import type ParcelConfig, {LoadedPlugin} from '../ParcelConfig';
import type {StaticRunOpts, RunAPI} from '../RequestTracker';
import type {
  Asset as InternalAsset,
  Bundle as InternalBundle,
  Config,
  DevDepRequest,
  ParcelOptions,
} from '../types';
import type {ConfigAndCachePath} from './ParcelConfigRequest';

import invariant from 'assert';
import assert from 'assert';
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
import {unique} from '@parcel/utils';
import {hashString} from '@parcel/hash';
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
import {
  joinProjectPath,
  fromProjectPathRelative,
  toProjectPathUnsafe,
} from '../projectPath';

type BundleGraphRequestInput = {|
  assetGraph: AssetGraph,
  changedAssets: Map<string, InternalAsset>,
  previousAssetGraphHash: ?string,
  optionsRef: SharedReference,
|};

type RunInput = {|
  input: BundleGraphRequestInput,
  ...StaticRunOpts,
|};

type BundleGraphRequest = {|
  id: string,
  +type: 'bundle_graph_request',
  run: RunInput => Async<BundleGraphRequestResult>,
  input: BundleGraphRequestInput,
|};
type BundleGraphRequestResult = {|
  bundleGraph: InternalBundleGraph,
  bundlerHash: string,
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
      return builder.bundle({
        graph: input.input.assetGraph,
        previousAssetGraphHash: input.input.previousAssetGraphHash,
        changedAssets: input.input.changedAssets,
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
      searchPath: toProjectPathUnsafe('index'),
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
    let {specifier, resolveFrom} = devDepRequest;
    let key = `${specifier}:${fromProjectPathRelative(resolveFrom)}`;
    this.devDepRequests.set(key, devDepRequest);
    await runDevDepRequest(this.api, devDepRequest);
  }

  async bundle({
    graph,
    previousAssetGraphHash,
    changedAssets,
  }: {|
    graph: AssetGraph,
    previousAssetGraphHash: ?string,
    changedAssets: Map<string, InternalAsset>,
  |}): Promise<BundleGraphRequestResult> {
    report({
      type: 'buildProgress',
      phase: 'bundling',
    });

    await this.loadConfigs();

    let plugin = await this.config.getBundler();
    let {plugin: bundler, name, resolveFrom} = plugin;

    let {cacheKey, bundlerHash} = await this.getHashes(graph);

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

    // if a previous asset graph hash is passed in, check if the bundle graph is also available
    let previousBundleGraphResult: ?BundleGraphRequestResult;
    if (!graph.unsafeToBundleIncrementally && previousAssetGraphHash != null) {
      try {
        previousBundleGraphResult = await this.api.getRequestResult<BundleGraphRequestResult>(
          'BundleGraph:' + previousAssetGraphHash,
        );
      } catch {
        // if the bundle graph had an error or was removed, don't fail the build
      }
    }
    if (
      previousBundleGraphResult == null ||
      previousBundleGraphResult?.bundlerHash !== bundlerHash
    ) {
      graph.markUnsafeToBundleIncrementally();
    }

    let internalBundleGraph;

    let logger = new PluginLogger({origin: this.config.getBundlerName()});

    try {
      if (!graph.unsafeToBundleIncrementally) {
        internalBundleGraph = nullthrows(previousBundleGraphResult).bundleGraph;
        for (let changedAsset of changedAssets.values()) {
          internalBundleGraph.updateAsset(changedAsset);
        }
      } else {
        internalBundleGraph = InternalBundleGraph.fromAssetGraph(graph);
        invariant(internalBundleGraph != null); // ensures the graph was created

        // $FlowFixMe
        await dumpGraphToGraphViz(internalBundleGraph._graph, 'before_bundle');
        let mutableBundleGraph = new MutableBundleGraph(
          internalBundleGraph,
          this.options,
        );

        // this the normal bundle workflow (bundle, optimizing, run-times, naming)
        await bundler.bundle({
          bundleGraph: mutableBundleGraph,
          config: this.configs.get(plugin.name)?.result,
          options: this.pluginOptions,
          logger,
        });

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
            await dumpGraphToGraphViz(
              // $FlowFixMe[incompatible-call]
              internalBundleGraph._graph,
              'after_optimize',
            );
          }
        }
      }
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, {
          origin: this.config.getBundlerName(),
        }),
      });
    } finally {
      invariant(internalBundleGraph != null); // ensures the graph was created
      // $FlowFixMe[incompatible-call]
      await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_bundle');
    }

    // Add dev dependency for the bundler. This must be done AFTER running it due to
    // the potential for lazy require() that aren't executed until the request runs.
    let devDepRequest = await createDevDependency(
      {
        specifier: name,
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
    // Also, pre-compute the hashes for each bundle so they are only computed once and shared between workers.
    internalBundleGraph.getBundleGraphHash();
    cacheSerializedObject(internalBundleGraph);

    // Recompute the cache key to account for new dev dependencies and invalidations.
    let {cacheKey: updatedCacheKey} = await this.getHashes(graph);
    let result = {
      bundleGraph: internalBundleGraph,
      bundlerHash,
    };
    this.api.storeResult(result, updatedCacheKey);
    return result;
  }

  async getHashes(
    assetGraph: AssetGraph,
  ): Promise<{|
    cacheKey: string,
    bundlerHash: string,
  |}> {
    // BundleGraphRequest needs hashes based on content (for quick retrieval)
    // and not-based on content (determine if the environment / config
    // changes that violate incremental bundling).
    let configs = (
      await Promise.all(
        [...this.configs].map(([pluginName, config]) =>
          getConfigHash(config, pluginName, this.options),
        ),
      )
    ).join('');

    let devDepRequests = [...this.devDepRequests.values()]
      .map(d => d.hash)
      .join('');

    let invalidations = await getInvalidationHash(
      this.api.getInvalidations(),
      this.options,
    );

    return {
      cacheKey: hashString(
        PARCEL_VERSION +
          assetGraph.getHash() +
          configs +
          devDepRequests +
          invalidations,
      ),
      bundlerHash: hashString(
        PARCEL_VERSION + this.config.getBundlerName() + configs,
      ),
    };
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
          specifier: namer.name,
          resolveFrom: namer.resolveFrom,
        },
        namer,
        this.previousDevDeps,
        this.options,
      );
      await this.runDevDepRequest(devDepRequest);
    }

    let bundleNames = bundles.map(b =>
      joinProjectPath(b.target.distDir, nullthrows(b.name)),
    );
    assert.deepEqual(
      bundleNames,
      unique(bundleNames),
      'Bundles must have unique names',
    );
  }

  async nameBundle(
    namers: Array<LoadedPlugin<Namer<mixed>>>,
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
