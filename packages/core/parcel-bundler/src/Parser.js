const path = require('path');
const es6 = require('./parsers/es6');
const json = require('./parsers/json');

class Parser {
  constructor(options = {}) {
    this.extensions = {};

    let extensions = options.extensions || {};
    for (let ext in extensions) {
      this.registerExtension(ext, extensions[ext]);
    }

    this.registerExtension('.js', es6);
    this.registerExtension('.jsx', es6);
    this.registerExtension('.es6', es6);
    this.registerExtension('.json', json);
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

  parse(filename, code) {
    let parser = this.findParser(filename);
    let options = Object.assign({filename: filename}, this.options);
    // console.log('parsing', filename)
    return parser(code, options);
  }
}

module.exports = Parser;
