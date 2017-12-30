const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');
const process = require('process');

class ElmAsset extends JSAsset {
  getParserOptions() {
    const defaultOptions = {
      yes: true,
      cwd: process.cwd()
    };
    return defaultOptions;
  }

  async parse() {
    let elmCompiler = await localRequire('node-elm-compiler', this.name);
    const options = this.getParserOptions();
    const data = elmCompiler.compileToStringSync(this.name, options);
    this.contents = data.toString();
    return await super.parse(this.contents);
  }
}

module.exports = ElmAsset;
