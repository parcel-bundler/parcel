// @flow strict-local

import type {
  Bundle as IBundle,
  Namer,
  FilePath,
  ConfigOutput,
} from '@parcel/types';
import type WorkerFarm, {SharedReference} from '@parcel/workers';
import type {Bundle as InternalBundle, ParcelOptions} from '../types';

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
import {normalizeSeparators, unique, md5FromObject} from '@parcel/utils';
import PluginOptions from '../public/PluginOptions';
import applyRuntimes from '../applyRuntimes';
import {PARCEL_VERSION} from '../constants';
import ParcelConfig from '../ParcelConfig';
import createParcelConfigRequest from './ParcelConfigRequest';

export default function createBundleGraphRequest(input) {
  return {
    id: input.assetGraph.getHash(),
    type: 'bundle_graph_request',
    run: async ({input, api, farm, options}) => {
      let {config} = nullthrows(
        await api.runRequest<null, ConfigAndCachePath>(
          createParcelConfigRequest(),
        ),
      );
      return new BundlerRunner({
        options,
        optionsRef: input.optionsRef,
        api,
        config: new ParcelConfig(
          config,
          options.packageManager,
          options.inputFS,
          options.autoinstall,
        ),
        workerFarm: farm,
      }).bundle(input.assetGraph);
    },
    input,
  };
}

class BundlerRunner {
  options: ParcelOptions;
  optionsRef: SharedReference;
  config: ParcelConfig;
  pluginOptions: PluginOptions;
  farm: WorkerFarm;
  api: RunAPI;
  isBundling: boolean = false;

  constructor(opts: Opts) {
    this.options = opts.options;
    this.optionsRef = opts.optionsRef;
    this.config = opts.config;
    this.pluginOptions = new PluginOptions(this.options);
    this.farm = opts.workerFarm;
    this.api = opts.api;
  }

  async bundle(graph: AssetGraph): Promise<InternalBundleGraph> {
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
    // if (!this.options.disableCache && !this.api.hasInvalidRequests()) {
    //   cacheKey = await this.getCacheKey(graph, configResult);
    //   let cachedBundleGraph = await this.options.cache.get<InternalBundleGraph>(
    //     cacheKey,
    //   );
    //   this.api.assertNotAborted();

    //   if (cachedBundleGraph) {
    //     return cachedBundleGraph;
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
    this.api.assertNotAborted();

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
    this.api.assertNotAborted();

    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_optimize');
    await this.nameBundles(internalBundleGraph);

    await applyRuntimes({
      bundleGraph: internalBundleGraph,
      requestTracker: this.api,
      config: this.config,
      options: this.options,
      optionsRef: this.optionsRef,
      pluginOptions: this.pluginOptions,
    });
    this.api.assertNotAborted();
    // $FlowFixMe
    await dumpGraphToGraphViz(internalBundleGraph._graph, 'after_runtimes');

    // if (cacheKey != null) {
    //   await this.options.cache.set(cacheKey, internalBundleGraph);
    // }
    this.api.assertNotAborted();

    return internalBundleGraph;
  }

  async getCacheKey(
    assetGraph: AssetGraph,
    configResult: ?ConfigOutput,
  ): Promise<string> {
    let name = this.config.getBundlerName();
    let {version} = await this.config.getBundler();

    return md5FromObject({
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

    let bundlePaths = bundles.map(b => b.filePath);
    assert.deepEqual(
      bundlePaths,
      unique(bundlePaths),
      'Bundles must have unique filePaths',
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

          let target = nullthrows(internalBundle.target);
          internalBundle.filePath = path.join(
            target.distDir,
            normalizeSeparators(name),
          );
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
