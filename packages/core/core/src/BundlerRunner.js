// @flow strict-local

import type AssetGraph from './AssetGraph';
import type {Namer, ParcelOptions, RuntimeAsset} from '@parcel/types';
import type {Bundle as InternalBundle} from './types';
import type Config from './Config';

import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {BundleGraph, MutableBundleGraph} from './public/BundleGraph';
import InternalBundleGraph from './BundleGraph';
import MainAssetGraph from './public/MainAssetGraph';
import {Bundle, NamedBundle} from './public/Bundle';
import AssetGraphBuilder from './AssetGraphBuilder';
import {report} from './ReporterRunner';
import {normalizeSeparators, unique} from '@parcel/utils';

type Opts = {|
  options: ParcelOptions,
  config: Config
|};

export default class BundlerRunner {
  options: ParcelOptions;
  config: Config;

  constructor(opts: Opts) {
    this.options = opts.options;
    this.config = opts.config;
  }

  async bundle(graph: AssetGraph): Promise<InternalBundleGraph> {
    report({
      type: 'buildProgress',
      phase: 'bundling'
    });

    let bundler = await this.config.getBundler();

    let bundleGraph = new InternalBundleGraph();
    await bundler.bundle({
      assetGraph: new MainAssetGraph(graph),
      bundleGraph: new MutableBundleGraph(bundleGraph),
      options: this.options
    });
    await this.nameBundles(bundleGraph);
    await this.applyRuntimes(bundleGraph);

    return bundleGraph;
  }

  async nameBundles(bundleGraph: InternalBundleGraph): Promise<void> {
    let namers = await this.config.getNamers();
    let bundles = [];
    bundleGraph.traverseBundles(bundle => {
      bundles.push(bundle);
    });

    await Promise.all(
      bundles.map(bundle => this.nameBundle(namers, bundle, bundleGraph))
    );

    let bundlePaths = bundles.map(b => b.filePath);
    assert.deepEqual(
      bundlePaths,
      unique(bundlePaths),
      'Bundles must have unique filePaths'
    );
  }

  async nameBundle(
    namers: Array<Namer>,
    internalBundle: InternalBundle,
    internalBundleGraph: InternalBundleGraph
  ): Promise<void> {
    let bundle = new Bundle(internalBundle);
    let bundleGraph = new BundleGraph(internalBundleGraph);

    for (let namer of namers) {
      let name = await namer.name({bundle, bundleGraph, options: this.options});

      if (name != null) {
        if (path.extname(name).slice(1) !== bundle.type) {
          throw new Error(
            `Destination name ${name} extension does not match bundle type "${
              bundle.type
            }"`
          );
        }

        let target = nullthrows(internalBundle.target);
        internalBundle.filePath = path.join(
          target.distDir,
          normalizeSeparators(name)
        );
        internalBundle.name = name;
        return;
      }
    }

    throw new Error('Unable to name bundle');
  }

  async applyRuntimes(bundleGraph: InternalBundleGraph): Promise<void> {
    let bundles = [];
    bundleGraph.traverseBundles(bundle => {
      bundles.push(new NamedBundle(bundle));
    });

    for (let bundle of bundles) {
      let runtimes = await this.config.getRuntimes(bundle.env.context);
      for (let runtime of runtimes) {
        let applied = await runtime.apply({
          bundle,
          bundleGraph: new BundleGraph(bundleGraph),
          options: this.options
        });
        if (applied) {
          await this.addRuntimesToBundle(
            bundle.id,
            bundleGraph,
            Array.isArray(applied) ? applied : [applied]
          );
        }
      }
    }
  }

  async addRuntimesToBundle(
    bundleId: string,
    bundleGraph: InternalBundleGraph,
    runtimeAssets: Array<RuntimeAsset>
  ) {
    let node = bundleGraph.nodes.get(bundleId);
    if (node == null) {
      throw new Error('Bundle not found');
    }
    if (node.type !== 'bundle') {
      throw new Error('Not a bundle id');
    }
    let bundle = node.value;

    for (let {code, filePath, dependency} of runtimeAssets) {
      let builder = new AssetGraphBuilder({
        options: this.options,
        config: this.config,
        assetRequest: {
          code,
          filePath,
          env: bundle.env
        }
      });

      // build a graph of just the transformed asset
      let {assetGraph: graph} = await builder.build();

      let entry = graph.getEntryAssets()[0];
      let subGraph = graph.getSubGraph(nullthrows(graph.getNode(entry.id)));

      // Exclude modules that are already included in an ancestor bundle
      let entryId = entry.id;
      subGraph.traverseAssets(asset => {
        if (bundleGraph.isAssetInAncestorBundle(bundle, asset)) {
          let removedId = subGraph.removeAsset(asset);
          if (entry.id === asset.id && removedId != null) {
            entryId = removedId;
          }
        }
      });

      // merge the transformed asset into the bundle's graph, and connect
      // the node to it.
      bundle.assetGraph.merge(subGraph);

      bundle.assetGraph.addEdge(
        dependency
          ? dependency.id
          : nullthrows(bundle.assetGraph.getRootNode()).id,
        entryId
      );
    }
  }
}
