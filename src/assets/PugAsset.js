const HTMLAsset = require('./HTMLAsset');
const localRequire = require('../utils/localRequire');

class PugAsset extends HTMLAsset {
  async parse(code) {
    let pug = await localRequire('pug', this.name);

    let options =
      this.package.pug || (await this.getConfig(['.pugrc', '.pugrc.js'])) || {};
    options.filename = this.name;
    if (!options.hasOwnProperty('pretty')) {
      options.pretty = true;
    }

    let fn = pug.compile(code, options);
    let locals = options.locals || {};
    this.contents = fn(locals);

    return await super.parse(this.contents);
  }
}

module.exports = PugAsset;
