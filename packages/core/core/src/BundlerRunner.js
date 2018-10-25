const path = require('path');

class BundlerRunner {
  constructor() {
    //...
  }

  // TODO: use plugin to create bundles
  bundle(graph /* , opts */) {
    let assets = Array.from(graph.nodes.values())
      .filter(node => node.type === 'asset')
      .map(node => node.value);

    return {
      bundles: [
        {
          destPath: path.join(process.cwd(), 'dist/bundle.js'),
          assets
        }
      ]
    };
  }
}

module.exports = BundlerRunner;
