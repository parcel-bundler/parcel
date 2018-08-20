const postcss = require('postcss');

const localRequire = require('../utils/localRequire');
const Asset = require('../Asset');
const CSSAst = require('./Ast.js').CSSAst;

class SSSAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'css';
  }

  async parse(code) {
    let sugarss = await localRequire('sugarss', this.name);
    let root = postcss.parse(code, {from: this.name, to: this.name, parser: sugarss});
    return new CSSAst(code, root);
  }
  
  generate() {
    return [
      {
        type: 'css',
        value: this.ast ? this.ast.render() : this.contents
      }
    ];
  }

}

module.exports = SSSAsset;
