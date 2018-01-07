const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');
const process = require('process');
const config = require('../utils/config');

class ElmAsset extends JSAsset {
  async getParserOptions() {
    let defaultOptions = {
      yes: true,
      cwd: process.cwd()
    };

    // grab other optios from package.elm.json
    const elmOptions = await config.load(this.name, ['elm-package.json']);

    if (elmOptions.nodeElmCompilerOptions) {
      defaultOptions = Object.assign(
        elmOptions.nodeElmCompilerOptions,
        defaultOptions
      );
    }

    // Use a local copy of elm-make when in test
    if (process.env.NODE_ENV === 'test') {
      defaultOptions.pathToMake = require.resolve('elm/binwrappers/elm-make');
    }
    return defaultOptions;
  }

  async parse() {
    const options = await this.getParserOptions();

    const elm = await localRequire('node-elm-compiler', this.name);

    this.contents = await elm.compileToString(this.name, options);

    return await super.parse(this.contents);
  }
}

module.exports = ElmAsset;
