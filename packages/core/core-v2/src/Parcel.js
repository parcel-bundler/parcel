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
    this.queue = new PQueue({
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
        controller.abort();
        this.queue.pause();
        this.queue.clear();
        this.handleChange(event);

        controller = new AbortController();
        signal = controller.signal;

        this.build({ signal });
      });
    }
  }

  async build({ signal }) {
    let graph = await this.completeGraph({ signal });
    // await graph.dumpGraphViz();
    let { bundles } = await this.bundle(graph);
    await this.package(bundles);
  }

  async completeGraph({ signal }) {
    for (let node of this.graph.incompleteNodes) {
      this.queue.add(() => this.processNode(node, { signal }));
    }

    this.queue.start();
    await this.queue.onIdle();

    if (signal.aborted) throw AbortError;

    return this.graph;
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
      this.queue.add(() => this.transform(fileNode, { signal }));
      if (this.watcher) this.watcher.watch(resolvedPath);
    }
  }

  async transform(fileNode, { signal }) {
    // console.log('transforming fileNode', fileNode)
    let { children: childAssets } = await this.transformerRunner.transform(fileNode.value);
    if (!signal.aborted) {
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
            this.queue.add(() => this.resolve(depNode, { signal }));
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
    this.graph.invalidateNode(filePath);
  }
}

module.exports = Parcel;
