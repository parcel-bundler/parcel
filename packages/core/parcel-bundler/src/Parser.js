const path = require('path');
const RawAsset = require('./Asset');
const JSAsset = require('./assets/JSAsset');
const JSONAsset = require('./assets/JSONAsset');
const CSSAsset = require('./assets/CSSAsset');
const StylusAsset = require('./assets/StylusAsset');
const GlobAsset = require('./assets/GlobAsset');
const LESSAsset = require('./assets/LESSAsset');
const SASSAsset = require('./assets/SASSAsset');
const glob = require('glob');

class Parser {
  constructor(options = {}) {
    this.extensions = {};

    let extensions = options.extensions || {};
    for (let ext in extensions) {
      this.registerExtension(ext, extensions[ext]);
    }

    this.registerExtension('.js', JSAsset);
    this.registerExtension('.jsx', JSAsset);
    this.registerExtension('.es6', JSAsset);
    this.registerExtension('.json', JSONAsset);

    this.registerExtension('.css', CSSAsset);
    this.registerExtension('.styl', StylusAsset);
    this.registerExtension('.less', LESSAsset);
    this.registerExtension('.sass', SASSAsset);
    this.registerExtension('.scss', SASSAsset);
  }

  registerExtension(ext, parser) {
    if (typeof parser === 'string') {
      parser = require(parser);
    }

    this.extensions[ext] = parser;
  }

  findParser(filename) {
    if (glob.hasMagic(filename)) {
      return GlobAsset;
    }

    let extension = path.extname(filename);
    return this.extensions[extension] || RawAsset;
  }

  getAsset(filename, pkg, options) {
    let Asset = this.findParser(filename);
    return new Asset(filename, pkg, options);
  }
}

module.exports = Parser;
