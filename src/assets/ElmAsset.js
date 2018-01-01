const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');
const process = require('process');

// Currently no pretty way to install Elm tools on behalf of the user :/
async function compile(name, options) {
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

class ElmAsset extends JSAsset {
  async getParserOptions() {
    const defaultOptions = {
      yes: true,
      cwd: process.cwd(),
      verbose: true
    };
    // Use a local copy of elm-make when in test
    if (process.env.NODE_ENV === 'test') {
      defaultOptions.pathToMake = require.resolve('elm/binwrappers/elm-make');
    }
    return defaultOptions;
  }

  async parse() {
    const options = await this.getParserOptions();
    const data = await compile(this.name, options);
    this.contents = data.toString();
    return await super.parse(this.contents);
  }
}

module.exports = ElmAsset;
