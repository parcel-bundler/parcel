try {
  module.exports = require('./index.js');
} catch (e) {
  module.exports = require('./index-wasm.js');
}
