const builtins = require('node-libs-browser');

for (let key in builtins) {
  if (builtins[key] == null) {
    builtins[key] = require.resolve('./_empty.js');
  }
}

builtins['_bundle_loader'] = require.resolve('./bundle-loader.js');

module.exports = builtins;
