// @flow
'use strict';
const path = require('path');
const { AbortController } = require('abortcontroller-polyfill/dist/cjs-ponyfill');
const PQueue = require('p-queue');
const AssetGraph = require('./AssetGraph');
const TransformerRunner = require('./TransformerRunner');
const ResolverRunner = require('./ResolverRunner');
const BundlerRunner = require('./BundlerRunner');
const PackagerRunner = require('./PackagerRunner');

// TODO: use custom config if present
const defaultConfig = require('@parcel/config-default');

const AbortError = new Error('Aborted!');

class Parcel {
  constructor({
    entries,
    parcelConfig = defaultConfig,
    cliOpts = {},
  }) {
    this.rootDir = process.cwd();

    this.graph = new AssetGraph({ entries, rootDir: this.rootDir });
    this.watcher = cliOpts.watch ? new Watcher() : null;
    this.updateQueue = new PQueue();
    this.mainQueue = new PQueue({
      autoStart: false,
    });

    this.transformerRunner = new TransformerRunner({ parcelConfig, cliOpts });
    this.resolverRunner = new ResolverRunner({ parcelConfig, cliOpts });
    this.bundlerRunner = new BundlerRunner({ parcelConfig, cliOpts });
    this.packagerRunner = new PackagerRunner({ parcelConfig, cliOpts });
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

  async build({ signal }) {
    await this.updateGraph();
    await this.completeGraph({ signal });
    // await graph.dumpGraphViz();
    let { bundles } = await this.bundle(this.graph);
    await this.package(bundles);
  }

  async updateGraph() {
    this.updateQueue.start();
    await this.updateQueue.onIdle();
    this.updateQueue.pause();
  }

  async completeGraph({ signal }) {
    for (let node of this.graph.incompleteNodes) {
      this.mainQueue.add(() => this.processNode(node, { signal }));
    }

    this.mainQueue.start();
    await this.mainQueue.onIdle();
    this.mainQueue.pause();

    if (signal.aborted) throw AbortError;
  }

  processNode(node, { signal }) {
    switch (node.type) {
      case 'dependency': return this.resolve(node, { signal });
      case 'file': return this.transform(node, { signal });
      default: throw new Error('Invalid Graph');
    }
  }

  async resolve(depNode, { signal }) {
    // console.log('resolving depNode', depNode)
    let resolvedPath = await this.resolverRunner.resolve(depNode.value);

    let file = { filePath: resolvedPath };
    if (!signal.aborted && !this.graph.hasFileNode(file)) {
      let fileNode = this.graph.addFileNode(depNode, file);
      this.mainQueue.add(() => this.transform(fileNode, { signal }));
      if (this.watcher) this.watcher.watch(resolvedPath);
    }
  }

  async transform(fileNode, { signal, shallow }) {
    // console.log('transforming fileNode', fileNode)
    let { children: childAssets } = await this.transformerRunner.transform(fileNode.value);
    if (signal && !signal.aborted) {
      let assetEdgesToRemove = fileNode.fromEdges;
      let depEdgesToRemove = [];

      for (let asset of childAssets) {
        let assetNode = this.graph.addAssetNode(fileNode, asset);
        assetEdgesToRemove = assetEdgesToRemove.filter(edge => edge.to === assetNode.id);

        let assetDepNodes = assetNode.fromEdges;
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
        let prunedFiles = invalidated.filter(node => node.type === 'file').map(node => node.value);
        for (let file of prunedFiles) {
          if (this.watcher) this.watcher.unWatch(file.filePath);
        }
      }
    }
  }

  bundle(graph) {
    return this.bundlerRunner.bundle(graph);
  }

  package(bundles) {
    return Promise.all(bundles.map(bundle => this.packagerRunner.runPackager({ bundle })));
  }

  handleChange(filePath) {
    let fileNode = this.graph.nodes.get(filePath);
    this.updateQueue.add(() => this.transform(fileNode, { shallow }));
  }
}

module.exports = Parcel;
