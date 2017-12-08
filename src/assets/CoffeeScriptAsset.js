const JSAsset = require('./JSAsset');
const config = require('../utils/config');
const localRequire = require('../utils/localRequire');

class CoffeeScriptAsset extends JSAsset {
  async transform() {
    super.transform();

    await this.parseIfNeeded();
    this.isAstDirty = true;
  }

  async parse(code) {
    // require coffeescript, installed locally in the app
    let coffee = localRequire('coffeescript', this.name);

    // Transpile Module using CoffeeScript and parse result as ast format through babylon
    return await super.parse(coffee.compile(code));
  }
}

module.exports = CoffeeScriptAsset;
