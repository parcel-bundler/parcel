const localRequire = require('../utils/localRequire');
const Asset = require('../Asset');

class MarkdownAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'html';
    this.hmrPageReload = true;
  }
  async generate() {
    let marked = await localRequire('marked', this.name);
    return marked(this.contents);
  }
}
module.exports = MarkdownAsset;
