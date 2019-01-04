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
    let loaders = new Set();
    let promises = [];
    bundleGraph.traverseBundles(bundle => {
      if (bundle.type !== 'js') {
        return;
      }

      bundle.assetGraph.traverse(node => {
        if (node.type === 'bundle') {
          console.log(node.value)
          // console.log(await this.config.getLoader(node.value.filePath))
          promises.push(Promise.resolve().then(async () => {
            let loader = await this.config.getLoader(node.value.filePath);
            // loaders.add(node.value.type);
            let file = await loader.generate(node.value);
            console.log(file)

            let asset = await this.addRuntimeAsset(bundleGraph, bundle, file.filePath);
            bundle.assetGraph.addEdge({from: node.id, to: asset.id});

            node.value.loader = asset.id;
          }));
        } else if (node.type === 'bundle_group') {
          promises.push(Promise.resolve().then(async () => {
            let runtime = await this.addRuntimeAsset(bundleGraph, bundle, __dirname + '/../../parcel-bundler/src/builtins/bundle-loader.js');
            bundle.assetGraph.addEdge({from: node.id, to: runtime.id});
            node.value.runtime = runtime.id;

            bundle.assetGraph.dumpGraphViz();
          }));
        }
      });
    });

    console.log(loaders)
    await Promise.all(promises);
  }

  async addRuntimeAsset(bundleGraph: BundleGraph, bundle: Bundle, file: FilePath) {
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
