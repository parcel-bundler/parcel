const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');

class CoffeeScriptAsset extends JSAsset {
  async parse(code) {
    // require coffeescript, installed locally in the app
    let coffee = await localRequire('coffeescript', this.name);

    // Transpile Module using CoffeeScript and parse result as ast format through babylon
    let transpiled = coffee.compile(code, {
      sourceMap: this.options.sourceMaps
    });

    if (transpiled.sourceMap) {
      this.sourceMap = transpiled.sourceMap.generate();
      this.sourceMap.sources = [this.relativeName];
      this.sourceMap.sourcesContent = [this.contents];
    }

    this.contents = this.options.sourceMaps ? transpiled.js : transpiled;
    return await super.parse(this.contents);
  }
}

module.exports = CoffeeScriptAsset;
