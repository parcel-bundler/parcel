const HTMLAsset = require('./HTMLAsset');
const localRequire = require('../utils/localRequire');

class PugAsset extends HTMLAsset {
  async parse(code) {
    // require pug, installed locally in the app
    let pug = await localRequire('pug', this.name);

    var fn = pug.compile(code, {});
    var html = fn({});

    // Transpile Module using Pug and parse result
    this.contents = html;
    return await super.parse(this.contents);
  }
}

module.exports = PugAsset;
