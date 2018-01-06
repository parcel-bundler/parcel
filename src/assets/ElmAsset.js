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
    const data = await this.compile(this.name, options);
    this.contents = data.toString();
    return await super.parse(this.contents);
  }

  // Currently no pretty way to install Elm tools on behalf of the user :/
  async compile(name, options) {
    try {
      const elmCompiler = await localRequire('node-elm-compiler', name);
      // compileToStringSync does not throw an Error, even when there is one.
      // Other methods will throw an error, but do not bubble up to Parcel
      const data = elmCompiler.compileToStringSync(name, options);
      if (!data) {
        throw 'You either have an error in your code, or are missing the Elm tools here https://guide.elm-lang.org/install.html.';
      }
      return data;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = ElmAsset;
