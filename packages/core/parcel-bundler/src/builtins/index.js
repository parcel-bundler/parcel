var nodeBuiltins = require('node-libs-browser');
 // patch with v1.0.0 to get path.parse
nodeBuiltins.path = require.resolve("path-browserify");

var builtins = Object.create(null);
for (var key in nodeBuiltins) {
  builtins[key] = nodeBuiltins[key] == null
    ? require.resolve('./_empty.js')
    : nodeBuiltins[key];
}

builtins['_bundle_loader'] = require.resolve('./bundle-loader.js');
builtins['_css_loader'] = require.resolve('./css-loader.js');

module.exports = builtins;
