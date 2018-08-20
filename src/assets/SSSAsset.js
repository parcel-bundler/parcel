const postcss = require('postcss');

const localRequire = require('../utils/localRequire');
const CSSAsset = require('./CSSAsset.js');
const CSSAst = require('./Ast.js').CSSAst;

class SSSAsset extends CSSAsset {
  constructor(name, options) {
    super(name, options);
    this.type = 'css';
  }

  async parse(code) {
    let sugarss = await localRequire('sugarss', this.name);
    let root = postcss.parse(code, {from: this.name, to: this.name, parser: sugarss});
    return new CSSAst(code, root);
  }
}

module.exports = SSSAsset;
