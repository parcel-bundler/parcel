const url = require('url');

module.exports = function loadNodeModule(bundle) {
  return require(url.fileURLToPath(bundle));
};
