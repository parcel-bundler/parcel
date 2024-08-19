const {Transformer} = require('@atlaspack/plugin');

module.exports = new Transformer({
  transform(asset) {
    return [asset];
  }
});
