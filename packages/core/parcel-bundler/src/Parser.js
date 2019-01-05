const path = require('path');
const RawAsset = require('./assets/RawAsset');
const GlobAsset = require('./assets/GlobAsset');
const {isGlob} = require('./utils/glob');

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
    this.registerExtension('elm', './assets/ElmAsset');
    this.registerExtension('vue', './assets/VueAsset');
    this.registerExtension('json', './assets/JSONAsset');
    this.registerExtension('json5', './assets/JSONAsset');
    this.registerExtension('jsonld', './assets/JSONLDAsset');
    this.registerExtension('yaml', './assets/YAMLAsset');
    this.registerExtension('yml', './assets/YAMLAsset');
    this.registerExtension('toml', './assets/TOMLAsset');
    this.registerExtension('gql', './assets/GraphqlAsset');
    this.registerExtension('graphql', './assets/GraphqlAsset');
    this.registerExtension('kt', './assets/KotlinAsset');

    this.registerExtension('css', './assets/CSSAsset');
    this.registerExtension('pcss', './assets/CSSAsset');
    this.registerExtension('postcss', './assets/CSSAsset');
    this.registerExtension('sss', './assets/SSSAsset');
    this.registerExtension('styl', './assets/StylusAsset');
    this.registerExtension('stylus', './assets/StylusAsset');
    this.registerExtension('less', './assets/LESSAsset');
    this.registerExtension('sass', './assets/SASSAsset');
    this.registerExtension('scss', './assets/SASSAsset');

    this.registerExtension('html', './assets/HTMLAsset');
    this.registerExtension('htm', './assets/HTMLAsset');
    this.registerExtension('rs', './assets/RustAsset');

    this.registerExtension('webmanifest', './assets/WebManifestAsset');

    this.registerExtension('glsl', './assets/GLSLAsset');
    this.registerExtension('vert', './assets/GLSLAsset');
    this.registerExtension('frag', './assets/GLSLAsset');

    this.registerExtension('jade', './assets/PugAsset');
    this.registerExtension('pug', './assets/PugAsset');

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
    if (!fromPipeline && isGlob(filename)) {
      return GlobAsset;
    }

    let extension = path.extname(filename).toLowerCase();
    let parser = this.extensions[extension] || RawAsset;
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
