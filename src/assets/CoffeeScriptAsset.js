const JSAsset = require('./JSAsset');
const localRequire = require('../utils/localRequire');

class CoffeeScriptAsset extends JSAsset {
  async parse(code) {
    // require coffeescript, installed locally in the app
    let coffee = await localRequire('coffeescript', this.name);

    // Transpile Module using CoffeeScript and parse result as ast format through babylon
    let transpiled = coffee.compile(code, {
      sourceMap: this.options.sourcemaps
    });
    if (transpiled.sourceMap) {
      this.sourcemap = transpiled.sourceMap.generate();
      this.sourcemap.sources = [this.relativename];
      this.sourcemap.sourcesContent = [this.contents];
    }
    this.contents = this.options.sourcemaps ? transpiled.js : transpiled;
    return await super.parse(this.contents);
  }
}

module.exports = CoffeeScriptAsset;
