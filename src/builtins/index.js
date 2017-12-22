var builtins = require('node-libs-browser');

for (var key in builtins) {
  if (builtins[key] == null) {
    builtins[key] = require.resolve('./_empty.js');
  }
}

builtins['_bundle_loader'] = require.resolve('./bundle-loader.js');
builtins['_css_loader'] = require.resolve('./css-loader.js');

module.exports = builtins;
