const Asset = require('../Asset');
const localRequire = require('../utils/localRequire');

class CoffeeScriptAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  async generate() {
    // require coffeescript, installed locally in the app
    let coffee = await localRequire('coffeescript', this.name);

    // Transpile Module using CoffeeScript and parse result as ast format through babylon
    let transpiled = coffee.compile(this.contents, {
      sourceMap: this.options.sourceMaps
    });

    let sourceMap;
    if (transpiled.sourceMap) {
      sourceMap = transpiled.sourceMap.generate();
      sourceMap.sources = [this.relativeName];
      sourceMap.sourcesContent = [this.contents];
    }

    return [
      {
        type: 'js',
        value: this.options.sourceMaps ? transpiled.js : transpiled,
        sourceMap
      }
    ];
  }
}

module.exports = CoffeeScriptAsset;
