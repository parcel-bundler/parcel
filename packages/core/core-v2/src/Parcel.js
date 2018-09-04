// @flow
'use strict';
import path from 'path';
import { AbortController } from 'abortcontroller-polyfill/dist/cjs-ponyfill';
import Watcher from '@parcel/watcher';
import PQueue from 'p-queue';
import AssetGraph, { type AssetGraphNode, DependencyNode, FileNode, AssetNode } from './AssetGraph';
import TransformerRunner from './TransformerRunner';
import ResolverRunner from './ResolverRunner';
import BundlerRunner from './BundlerRunner';
import PackagerRunner from './PackagerRunner';

// TODO: use custom config if present
const defaultConfig = require('@parcel/config-default');

const AbortError = new Error('Aborted!');

type CliOpts = {
  watch?: boolean
}

type ParcelOpts = {
  entries: Array<string>,
  cliOpts: CliOpts,
}

type Signal = {
  aborted: boolean,
  addEventListener?: Function,
}

type BuildOpts = {
  signal: Signal,
  shallow?: boolean,
}

export default class Parcel {
  rootDir: string;
  graph: AssetGraph;
  watcher: Watcher;
  updateQueue: PQueue;
  mainQueue: PQueue;
  transformerRunner: TransformerRunner;
  resolverRunner: ResolverRunner;
  bundlerRunner: BundlerRunner;
  packagerRunner: PackagerRunner;

  constructor({
    entries,
    cliOpts = {},
  }: ParcelOpts) {
    this.rootDir = process.cwd();

    this.graph = new AssetGraph({ entries, rootDir: this.rootDir });
    this.watcher = cliOpts.watch ? new Watcher() : null;
    this.updateQueue = new PQueue({ autoStart: false });
    this.mainQueue = new PQueue({ autoStart: false });

    this.transformerRunner = new TransformerRunner({ parcelConfig: defaultConfig, cliOpts });
    this.resolverRunner = new ResolverRunner();
    this.bundlerRunner = new BundlerRunner({ parcelConfig: defaultConfig, cliOpts });
    this.packagerRunner = new PackagerRunner({ parcelConfig: defaultConfig, cliOpts });
  }

  run() {
    let controller = new AbortController();
    let signal = controller.signal;

    this.build({ signal });

    if (this.watcher) {
      this.watcher.on('change', event => {
        if (!this.updateQueue.isPaused) {
          this.handleChange(event);
        } else {
          controller.abort();
          this.mainQueue.pause();
          this.mainQueue.clear();
          this.handleChange(event);

          controller = new AbortController();
          signal = controller.signal;

          this.build({ signal });
        }
      });
    }
  }

  async build({ signal }: BuildOpts) {
    console.log('Starting build');
    await this.updateGraph();
    await this.completeGraph({ signal });
    // await graph.dumpGraphViz();
    let { bundles } = await this.bundle();
    await this.package(bundles);
    console.log('Finished build')
  }

  async updateGraph() {
    this.updateQueue.start();
    await this.updateQueue.onIdle();
    this.updateQueue.pause();
  }

  async completeGraph({ signal }: BuildOpts) {
    for (let node of this.graph.incompleteNodes) {
      this.mainQueue.add(() => this.processNode(node, { signal }));
    }

    this.mainQueue.start();
    await this.mainQueue.onIdle();
    this.mainQueue.pause();

    if (signal.aborted) throw AbortError;
  }

  processNode(node: AssetGraphNode, { signal }: BuildOpts) {
    switch (node.type) {
      case 'dependency': return this.resolve(node, { signal });
      case 'file': return this.transform(node, { signal });
      default: throw new Error('Invalid Graph');
    }
  }

  async resolve(depNode: DependencyNode, { signal }: BuildOpts) {
    // console.log('resolving depNode', depNode)
    let resolvedPath = await this.resolverRunner.resolve(depNode.value);

    let file = { filePath: resolvedPath };
    if (!signal.aborted && !this.graph.hasFileNode(file)) {
      let fileNode = this.graph.addFileNode(depNode, file);
      this.mainQueue.add(() => this.transform(fileNode, { signal }));
      if (this.watcher) this.watcher.watch(resolvedPath);
    }
  }

  async transform(fileNode: FileNode, { signal, shallow }: BuildOpts) {
    // console.log('transforming fileNode', fileNode)
    let { children: childAssets } = await this.transformerRunner.transform(fileNode.value);
    if (signal && !signal.aborted) {
      let assetEdgesToRemove = Array.from(this.graph.edges).filter(edge => edge.from === fileNode.id);
      let depEdgesToRemove = [];

      for (let asset of childAssets) {
        let assetNode = this.graph.addAssetNode(fileNode, asset);
        assetEdgesToRemove = assetEdgesToRemove.filter(edge => edge.to === assetNode.id);

        let assetDepNodes = Array.from(this.graph.edges).filter(edge => edge.from === assetNode.id);
        depEdgesToRemove = depEdgesToRemove.concat(assetDepNodes);

        for (let dep of asset.dependencies) {
          dep.sourcePath = fileNode.value.filePath; // ? Should this be done elsewhere?
          if (!this.graph.hasDependencyNode(dep)) {
            let depNode = this.graph.addDependencyNode(assetNode, dep);
            if (!shallow) this.mainQueue.add(() => this.resolve(depNode, { signal }));
          } else {
            let depNode = this.graph.getDependencyNode(dep);
            depEdgesToRemove = depEdgesToRemove.filter(edge => edge.to === depNode.id);
          }
        }
      }

      let edgesToRemove = [...assetEdgesToRemove, ...depEdgesToRemove];
      for (let edge of edgesToRemove) {
        let invalidated = this.graph.removeEdge(edge);
        for (let nodeOrEdge of invalidated) {
          if (nodeOrEdge.type === 'file' && this.watcher) {
            let fileNode: any = nodeOrEdge;
            if (this.watcher) this.watcher.unWatch(fileNode.value.filePath);
          }
        }
      }
    }
  }

  bundle() {
    return this.bundlerRunner.bundle(this.graph);
  }

  // TODO: implement bundle types
  package(bundles: any) {
    return Promise.all(bundles.map(bundle => this.packagerRunner.runPackager({ bundle })));
  }

  handleChange(filePath: string) {
    let file = { filePath };
    if (this.graph.hasFileNode({ filePath })) {
      let fileNode = this.graph.getFileNode(file);
      this.updateQueue.add(() => this.transform(fileNode, { signal: { aborted: false }, shallow: true }));
    }
  }
}
