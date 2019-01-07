// @flow
import type {
  AssetGraph,
  Namer,
  Bundle,
  FilePath,
  CLIOptions
} from '@parcel/types';
import type Config from './Config';
import BundleGraph from './BundleGraph';
import AssetGraphBuilder from './AssetGraphBuilder';
import Asset from './Asset';
import path from 'path';

type Opts = {
  cliOpts: CLIOptions,
  config: Config,
  rootDir: FilePath
};

export default class BundlerRunner {
  cliOpts: CLIOptions;
  config: Config;
  rootDir: FilePath;

  constructor(opts: Opts) {
    this.cliOpts = opts.cliOpts;
    this.config = opts.config;
    this.rootDir = opts.rootDir;
  }

  async bundle(graph: AssetGraph) {
    let bundler = await this.config.getBundler();

    let bundleGraph = new BundleGraph();
    await bundler.bundle(graph, bundleGraph, this.cliOpts);
    await this.nameBundles(bundleGraph);

    await this.addLoaders(bundleGraph);

    return bundleGraph;
  }

  async nameBundles(bundleGraph: BundleGraph) {
    let namers = await this.config.getNamers();
    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      promises.push(this.nameBundle(namers, bundle));
    });

    await Promise.all(promises);
  }

  async nameBundle(namers: Array<Namer>, bundle: Bundle) {
    for (let namer of namers) {
      let filePath = await namer.name(bundle, {
        rootDir: this.rootDir
      });

      if (filePath) {
        bundle.filePath = filePath;
        return;
      }
    }

    throw new Error('Unable to name bundle');
  }

  async addLoaders(bundleGraph: BundleGraph) {
    // Dependency ids in code replaced with referenced bundle names
    // Loader runtime added for bundle groups that don't have a native loader (e.g. HTML/CSS/Worker - isURL?),
    // and which are not loaded by a parent bundle.
    // Loaders also added for modules that were moved to a separate bundle because they are a different type
    // (e.g. WASM, HTML). These should be preloaded prior to the bundle being executed. Replace the entry asset(s)
    // with the preload module.

    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      if (bundle.type !== 'js') {
        return;
      }

      bundle.assetGraph.traverse(node => {
        if (node.type === 'bundle_group') {
          promises.push(
            Promise.resolve().then(async () => {
              let bundles = bundle.assetGraph
                .getNodesConnectedFrom(node)
                .map(node => node.value);

              let loaders = await Promise.all(bundles.map(async b => {
                 let loader = await this.config.getLoader(
                  bundle.filePath,
                  b.filePath
                );
                let file = await loader.generate(bundle);

                let asset = await this.addRuntimeAsset(
                  bundleGraph,
                  bundle,
                  file.filePath
                );
                bundle.assetGraph.addEdge({from: b.id, to: asset.id});
                return asset;
              }));

              let asset = await this.addRuntimeAsset(bundleGraph, bundle, {
                filePath: this.rootDir + '/test.js',
                env: node.value.dependency.env,
                code: `module.exports = require('${path.relative(
                  this.rootDir,
                  __dirname +
                    '/../../parcel-bundler/src/builtins/bundle-loader.js'
                )}')(${JSON.stringify(
                  bundles
                    .map((b, i) => [loaders[i].id, path.relative(path.dirname(bundle.filePath), b.filePath)])
                    .concat(node.value.entryAssetId)
                )});`
              });

              // let runtime = await this.config.getLoaderRuntime(bundle.filePath);
              // let res = await runtime.generate(node.value.dependency.env, bundles, node.value);
              // console.log(res);

              bundle.assetGraph.addEdge({from: node.id, to: asset.id});
              bundle.assetGraph.dumpGraphViz();
            })
          );
        }
      });
    });

    await Promise.all(promises);
  }

  async addRuntimeAsset(
    bundleGraph: BundleGraph,
    bundle: Bundle,
    file: TransformerRequest
  ) {
    let builder = new AssetGraphBuilder({
      farm: this.farm,
      cliOpts: this.cliOpts,
      config: this.config,
      entries: [file],
      targets: [bundle.target],
      rootDir: this.rootDir
    });

    let graph = await builder.build();
    let entry = graph.getEntryAssets()[0];
    let subGraph = graph.getSubGraph(graph.getNode(entry.id));
    bundle.assetGraph.merge(subGraph);
    return entry;
  }
}
