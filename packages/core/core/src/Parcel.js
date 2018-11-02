// @flow
'use strict';
import {AbortController} from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import Watcher from '@parcel/watcher';
import PQueue from 'p-queue';
import AssetGraph from './AssetGraph';
import {Node} from './Graph';
import type {Bundle, CLIOptions, Dependency, File} from '@parcel/types';
import TransformerRunner from './TransformerRunner';
import ResolverRunner from './ResolverRunner';
import BundlerRunner from './BundlerRunner';
import PackagerRunner from './PackagerRunner';
import Config from './Config';
import WorkerFarm from '@parcel/workers';

// TODO: use custom config if present
const defaultConfig = require('@parcel/config-default');

const abortError = new Error('Build aborted');

type ParcelOpts = {
  entries: Array<string>,
  cwd?: string,
  cliOpts: CLIOptions
};

type Signal = {
  aborted: boolean,
  addEventListener?: Function
};

type BuildOpts = {
  signal: Signal,
  shallow?: boolean
};

export default class Parcel {
  entries: Array<string>;
  rootDir: string;
  graph: AssetGraph;
  watcher: Watcher;
  updateQueue: PQueue;
  mainQueue: PQueue;
  resolverRunner: ResolverRunner;
  bundlerRunner: BundlerRunner;
  farm: WorkerFarm;
  runTransform: (file: File) => Promise<any>;
  runPackage: (bundle: Bundle) => Promise<any>;

  constructor({entries, cliOpts = {}}: ParcelOpts) {
    this.rootDir = process.cwd();

    this.graph = new AssetGraph({entries, rootDir: this.rootDir});
    this.watcher = cliOpts.watch ? new Watcher() : null;
    this.updateQueue = new PQueue({autoStart: false});
    this.mainQueue = new PQueue({autoStart: false});

    let config = new Config(
      defaultConfig,
      require.resolve('@parcel/config-default')
    );
    this.resolverRunner = new ResolverRunner({
      config,
      cliOpts,
      rootDir: this.rootDir
    });
    this.bundlerRunner = new BundlerRunner({
      config,
      cliOpts
    });
    this.farm = new WorkerFarm(
      {
        parcelConfig: defaultConfig,
        cliOpts
      },
      {
        workerPath: require.resolve('./worker')
      }
    );

    this.runTransform = this.farm.mkhandle('runTransform');
    this.runPackage = this.farm.mkhandle('runPackage');
  }

  async run() {
    let controller = new AbortController();
    let signal = controller.signal;

    let buildPromise = this.build({signal});

    if (this.watcher) {
      this.watcher.on('change', event => {
        // The build step starts by updating the graph with all of the changes in the update queue
        if (!this.updateQueue.isPaused) {
          // If a change comes in while the graph is being updated, just add it to the update queue
          this.handleChange(event);
        } else {
          // Otherwise cancel any work that may be in progress, add the change to the update queue,
          // and start a new build.
          controller.abort();
          this.mainQueue.pause();
          this.mainQueue.clear();
          this.handleChange(event);

          controller = new AbortController();
          signal = controller.signal;

          this.build({signal});
        }
      });
    }

    await buildPromise;
  }

  async build({signal}: BuildOpts) {
    try {
      console.log('Starting build'); // eslint-disable-line no-console
      await this.updateGraph();
      await this.completeGraph({signal});
      // await this.graph.dumpGraphViz();
      let bundles = await this.bundle();
      await this.package(bundles);

      if (!this.watcher) {
        await this.farm.end();
      }

      console.log('Finished build'); // eslint-disable-line no-console
    } catch (e) {
      if (e !== abortError) {
        console.error(e); // eslint-disable-line no-console
      }
    }
  }

  async updateGraph() {
    // Process all changes that may update the middle of the the graph
    this.updateQueue.start();
    await this.updateQueue.onIdle();
    this.updateQueue.pause();
  }

  async completeGraph({signal}: BuildOpts) {
    // AssetGraph keeps track of nodes that represent files that have not been transformed
    // and dependencies that have not been resolved so that rebuilds start from the leaves
    // of the graph
    for (let [, node] of this.graph.incompleteNodes) {
      this.mainQueue.add(() => this.processNode(node, {signal}));
    }

    // Process and build out the edges of the graph
    this.mainQueue.start();
    await this.mainQueue.onIdle();
    this.mainQueue.pause();

    if (signal.aborted) throw abortError;
  }

  processNode(node: Node, {signal}: BuildOpts) {
    switch (node.type) {
      case 'dependency':
        return this.resolve(node.value, {signal});
      case 'file':
        return this.transform(node.value, {signal});
      default:
        throw new Error('Invalid Graph');
    }
  }

  async resolve(dep: Dependency, {signal}: BuildOpts) {
    // console.log('resolving dependency', dep);
    let resolvedPath = await this.resolverRunner.resolve(dep);

    let file = {filePath: resolvedPath};
    if (signal && !signal.aborted) {
      let {newFile} = this.graph.updateDependency(dep, file);

      if (newFile) {
        this.mainQueue.add(() => this.transform(newFile, {signal}));
        if (this.watcher) this.watcher.watch(newFile.filePath);
      }
    }
  }

  async transform(file: File, {signal, shallow}: BuildOpts) {
    // console.log('transforming file', file);
    let {assets: childAssets} = await this.runTransform(file);

    if (signal && !signal.aborted) {
      let {prunedFiles, newDeps} = this.graph.updateFile(file, childAssets);

      if (this.watcher) {
        for (let file of prunedFiles) {
          this.watcher.unwatch(file.filePath);
        }
      }

      // The shallow option is used for updating, which only works on files that changed
      // It is best not to add anything to the main queue until the udate queue is empty
      if (!shallow) {
        for (let dep of newDeps) {
          this.mainQueue.add(() => this.resolve(dep, {signal}));
        }
      }
    }
  }

  bundle() {
    return this.bundlerRunner.bundle(this.graph);
  }

  // TODO: implement bundle types
  package(bundles: any[]) {
    return Promise.all(bundles.map(bundle => this.runPackage(bundle)));
  }

  handleChange(filePath: string) {
    let file = {filePath};
    if (this.graph.hasNode(filePath)) {
      this.updateQueue.add(() =>
        this.transform(file, {signal: {aborted: false}, shallow: true})
      );
    }
  }
}
