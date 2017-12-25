const path = require('path');
const RawAsset = require('./assets/RawAsset');
const GlobAsset = require('./assets/GlobAsset');
const glob = require('glob');

class Parser {
  constructor(options = {}) {
    this.extensions = {};

    this.registerExtension('js', './assets/JSAsset');
    this.registerExtension('jsx', './assets/JSAsset');
    this.registerExtension('es6', './assets/JSAsset');
    this.registerExtension('jsm', './assets/JSAsset');
    this.registerExtension('mjs', './assets/JSAsset');
    this.registerExtension('ml', './assets/ReasonAsset');
    this.registerExtension('re', './assets/ReasonAsset');
    this.registerExtension('ts', './assets/TypeScriptAsset');
    this.registerExtension('tsx', './assets/TypeScriptAsset');
    this.registerExtension('coffee', './assets/CoffeeScriptAsset');
    this.registerExtension('json', './assets/JSONAsset');
    this.registerExtension('yaml', './assets/YAMLAsset');
    this.registerExtension('yml', './assets/YAMLAsset');

    this.registerExtension('css', './assets/CSSAsset');
    this.registerExtension('pcss', './assets/CSSAsset');
    this.registerExtension('styl', './assets/StylusAsset');
    this.registerExtension('less', './assets/LESSAsset');
    this.registerExtension('sass', './assets/SASSAsset');
    this.registerExtension('scss', './assets/SASSAsset');

    this.registerExtension('html', './assets/HTMLAsset');

    let extensions = options.extensions || {};
    for (let ext in extensions) {
      this.registerExtension(ext, extensions[ext]);
    }
  }

  registerExtension(ext, parser) {
    if (!ext.startsWith('.')) {
      ext = '.' + ext;
    }

    this.extensions[ext] = parser;
  }

  findParser(filename) {
    if (glob.hasMagic(filename)) {
      return GlobAsset;
    }

    let extension = path.extname(filename);
    let parser = this.extensions[extension] || RawAsset;
    if (typeof parser === 'string') {
      parser = this.extensions[extension] = require(parser);
    }

    return parser;
  }

  getAsset(filename, pkg, options = {}) {
    let Asset = this.findParser(filename);
    options.parser = this;
    return new Asset(filename, pkg, options);
  }
}

module.exports = Parser;
