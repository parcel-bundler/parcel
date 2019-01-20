const localRequire = require('../utils/localRequire');
const Asset = require('../Asset');

class MarkdownAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'html';
    this.needsPipelineProcessing = true;
    this.hmrPageReload = true;
  }
  async parse(code) {
    let marked = await localRequire('marked', this.name);
    this.contents = marked(code);
    return this.contents;
  }
}
module.exports = MarkdownAsset;
