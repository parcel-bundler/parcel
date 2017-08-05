const path = require('path');
const JSAsset = require('./assets/JSAsset');
const JSONAsset = require('./assets/JSONAsset');

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
  }

  registerExtension(ext, parser) {
    if (typeof parser === 'string') {
      parser = require(parser);
    }

    this.extensions[ext] = parser;
  }

  findParser(filename) {
    let extension = path.extname(filename);
    let parser = this.extensions[extension];
    if (!parser) {
      throw new Error('Could not find parser for extension ' + extension);
    }

    return parser;
  }

  getAsset(filename, options) {
    let Asset = this.findParser(filename);
    return new Asset(filename, options);
  }
}

module.exports = Parser;
