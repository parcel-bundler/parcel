var nodeBuiltins = require('node-libs-browser');

var builtins = Object.create(null);
for (var key in nodeBuiltins) {
  builtins[key] =
    nodeBuiltins[key] == null
      ? require.resolve('./_empty.js')
      : nodeBuiltins[key];
}

export default builtins;
