const localRequire = require('../utils/localRequire');
const HTMLAsset = require('./HTMLAsset');

class MarkdownAsset extends HTMLAsset {
  async parse(code) {
    let marked = await localRequire('marked', this.name);
    return HTMLAsset.prototype.parse.bind(this)(marked(code));
  }
}

module.exports = MarkdownAsset;
