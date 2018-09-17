var nodeBuiltins = require('node-libs-browser');

var builtins = Object.create(null);
for (var key in nodeBuiltins) {
  builtins[key] = nodeBuiltins[key] == null
    ? require.resolve('./_empty.js')
    : nodeBuiltins[key];
}

builtins['_bundle_loader'] = require.resolve('./bundle-loader.js');
builtins['_css_loader'] = require.resolve('./css-loader.js');

module.exports = builtins;
