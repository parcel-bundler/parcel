const postcss = require('postcss');
const localRequire = require('../utils/localRequire');
const Asset = require('../Asset');
const CSSAst = require('./CSSAst');

class SSSAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'css';
  }

  async parse(code) {
    let sugarss = await localRequire('sugarss', this.name);
    let root = postcss.parse(code, {
      from: this.name,
      to: this.name,
      parser: sugarss
    });
    return new CSSAst(code, root);
  }

  async generate() {
    await this.parseIfNeeded();

    return [
      {
        type: 'css',
        value: this.ast.render()
      }
    ];
  }
}

module.exports = SSSAsset;
