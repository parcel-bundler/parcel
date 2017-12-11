const path = require('path');
const RawAsset = require('./assets/RawAsset');
const GlobAsset = require('./assets/GlobAsset');
const glob = require('glob');
const toType = require('./utils/toType');

const isRegexp = /^\/.+?\/[gimuy]+?/;

class Parser {
  constructor(options = {}) {
    this.extensions = {};

    this.registerExtension('js', './assets/JSAsset');
    this.registerExtension('jsx', './assets/JSAsset');
    this.registerExtension('es6', './assets/JSAsset');
    this.registerExtension('jsm', './assets/JSAsset');
    this.registerExtension('mjs', './assets/JSAsset');
    this.registerExtension('ts', './assets/TypeScriptAsset');
    this.registerExtension('tsx', './assets/TypeScriptAsset');
    this.registerExtension('json', './assets/JSONAsset');
    this.registerExtension('yaml', './assets/YAMLAsset');
    this.registerExtension('yml', './assets/YAMLAsset');

    this.registerExtension('css', './assets/CSSAsset');
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
    const type = toType(ext);

    if (type === 'regexp' || isRegexp.test(ext)) {
      ext = ext.toString();
    } else if (!ext.startsWith('.')) {
      ext = '.' + ext;
    }

    this.extensions[ext] = parser;
  }

  // find extension key
  findExt(ext) {
    const keys = Object.keys(this.extensions);

    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];

      if (isRegexp.test(key) && new RegExp(key, 'i').test(ext)) {
        return key;
      } else if (ext === key) {
        key;
        return key;
      }
      isRegexp.lastIndex = 0;
    }
  }

  findParser(filename) {
    if (glob.hasMagic(filename)) {
      return GlobAsset;
    }

    const fileExt = path.extname(filename);
    let extension = this.findExt(fileExt);
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
