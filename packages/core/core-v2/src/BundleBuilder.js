const path = require('path');
// const PackagerRunner = require('./PackagerRunner');

class BundleBuilder {
  constructor() {
    // this.packagerRunner = new PackagerRunner();
  }

  async build(graph, opts) {
    let bundleManifest = this.generateBundleManifest(graph, opts);
    return bundleManifest;
    // TODO: uncomment once packagerRunner works with cache again
    // await this.buildBundles(bundleManifest);
  }

  generateBundleManifest(graph, opts) {
    let assets = Array.from(graph.nodes.values()).filter(node => node.type === 'asset');

    return {
      bundles: [{
        destPath: path.join(opts.destFolder, 'bundle.js'),
        assets,
      }]
    }
  }

  async buildBundles(bundleManifest) {
    await Promise.all(bundleManifest.bundles.map(bundle => this.packagerRunner.runPackager({ bundle })));
  }
}

module.exports = BundleBuilder;
