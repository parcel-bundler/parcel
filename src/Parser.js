// @flow
const path = require('path');
const RawAsset = require('./assets/RawAsset');
const GlobAsset = require('./assets/GlobAsset');
const glob = require('glob');
import type {Extensions} from './types';

const unsafeRequire = require;

export type ParserOptions = {
  extensions?: Extensions
};

class Parser {
  extensions: Extensions;

  constructor(options: ParserOptions = {}) {
    this.extensions = {};

    this.registerExtension('js', './assets/JSAsset');
    this.registerExtension('jsx', './assets/JSAsset');
    this.registerExtension('es6', './assets/JSAsset');
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

  registerExtension(ext: string, parser: string) {
    if (!ext.startsWith('.')) {
      ext = '.' + ext;
    }

    this.extensions[ext] = parser;
  }

  findParser(filename: string) {
    if (glob.hasMagic(filename)) {
      return GlobAsset;
    }

    let extension = path.extname(filename);
    let parser = this.extensions[extension] || RawAsset;
    if (typeof parser === 'string') {
      parser = this.extensions[extension] = unsafeRequire(parser);
    }

    return parser;
  }

  getAsset(filename: string, pkg: any, options: {parser?: Parser} = {}) {
    let Asset = this.findParser(filename);
    options.parser = this;
    return new Asset(filename, pkg, options);
  }
}

module.exports = Parser;
