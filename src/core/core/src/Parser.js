const path = require('path');
const glob = require('glob');

class Parser {
  constructor(options = {}) {
    this.extensions = {};

    this.RawAsset = require('@parcel/transform-raw');
    this.GlobAsset = require('@parcel/transform-glob');

    this.registerExtension('js', '@parcel/transform-js');
    this.registerExtension('jsx', '@parcel/transform-js');
    this.registerExtension('es6', '@parcel/transform-js');
    this.registerExtension('jsm', '@parcel/transform-js');
    this.registerExtension('mjs', '@parcel/transform-js');
    this.registerExtension('ml', '@parcel/transform-reason');
    this.registerExtension('re', '@parcel/transform-reason');
    this.registerExtension('ts', '@parcel/transform-typescript');
    this.registerExtension('tsx', '@parcel/transform-typescript');
    this.registerExtension('coffee', '@parcel/transform-coffeescript');
    this.registerExtension('vue', '@parcel/transform-vue');
    this.registerExtension('json', '@parcel/transform-json');
    this.registerExtension('json5', '@parcel/transform-json');
    this.registerExtension('yaml', '@parcel/transform-yaml');
    this.registerExtension('yml', '@parcel/transform-yaml');
    this.registerExtension('toml', '@parcel/transform-toml');
    this.registerExtension('gql', '@parcel/transform-graphql');
    this.registerExtension('graphql', '@parcel/transform-graphql');

    this.registerExtension('css', '@parcel/transform-css');
    this.registerExtension('pcss', '@parcel/transform-css');
    this.registerExtension('styl', '@parcel/transform-stylus');
    this.registerExtension('stylus', '@parcel/transform-stylus');
    this.registerExtension('less', '@parcel/transform-less');
    this.registerExtension('sass', '@parcel/transform-sass');
    this.registerExtension('scss', '@parcel/transform-sass');

    this.registerExtension('html', '@parcel/transform-html');
    this.registerExtension('htm', '@parcel/transform-html');
    this.registerExtension('rs', '@parcel/transform-rust');

    this.registerExtension('webmanifest', '@parcel/transform-webmanifest');

    this.registerExtension('glsl', '@parcel/transform-glsl');
    this.registerExtension('vert', '@parcel/transform-glsl');
    this.registerExtension('frag', '@parcel/transform-glsl');

    this.registerExtension('jade', '@parcel/transform-pug');
    this.registerExtension('pug', '@parcel/transform-pug');

    let extensions = options.extensions || {};
    for (let ext in extensions) {
      this.registerExtension(ext, extensions[ext]);
    }
  }

  registerExtension(ext, parser) {
    if (!ext.startsWith('.')) {
      ext = '.' + ext;
    }

    this.extensions[ext.toLowerCase()] = parser;
  }

  findParser(filename, fromPipeline) {
    if (!fromPipeline && /[*+{}]/.test(filename) && glob.hasMagic(filename)) {
      return this.GlobAsset;
    }

    let extension = path.extname(filename).toLowerCase();
    let parser = this.extensions[extension] || this.RawAsset;
    if (typeof parser === 'string') {
      parser = this.extensions[extension] = require(parser);
    }

    return parser;
  }

  getAsset(filename, options = {}) {
    let Asset = this.findParser(filename);
    options.parser = this;
    return new Asset(filename, options);
  }
}

module.exports = Parser;
