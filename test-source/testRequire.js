const path = require('path');

module.exports = function(location) {
  let sourcePath =
    parseInt(process.versions.node, 10) < 8 ? '../lib/' : '../src/';
  return require(path.join(sourcePath, location));
};
