const path = require('path');
const logger = require('@parcel/logger');
const RawAsset = require('./assets/RawAsset');
const GlobAsset = require('./assets/GlobAsset');
const {isGlob} = require('./utils/glob');

class Parser {
  constructor(options = {}) {
    this.extensions = {};

    this.registerExtension('js', require('./assets/JSAsset'));
    this.registerExtension('jsx', require('./assets/JSAsset'));
    this.registerExtension('es6', require('./assets/JSAsset'));
    this.registerExtension('jsm', require('./assets/JSAsset'));
    this.registerExtension('mjs', require('./assets/JSAsset'));
    this.registerExtension('ts', require('./assets/TypeScriptAsset'));
    this.registerExtension('tsx', require('./assets/TypeScriptAsset'));
    this.registerExtension('json', require('./assets/JSONAsset'));
    this.registerExtension('json5', require('./assets/JSONAsset'));
    this.registerExtension('jsonld', './assets/JSONLDAsset');
    this.registerExtension('yaml', require('./assets/YAMLAsset'));
    this.registerExtension('yml', require('./assets/YAMLAsset'));
    this.registerExtension('toml', require('./assets/TOMLAsset'));
    this.registerExtension('gql', require('./assets/GraphqlAsset'));
    this.registerExtension('graphql', require('./assets/GraphqlAsset'));

    if (!process.browser) {
      this.registerExtension('vue', require('./assets/VueAsset'));
      this.registerExtension('ml', require('./assets/ReasonAsset'));
      this.registerExtension('re', require('./assets/ReasonAsset'));
      this.registerExtension('coffee', require('./assets/CoffeeScriptAsset'));
      this.registerExtension('elm', require('./assets/ElmAsset'));
      this.registerExtension('kt', require('./assets/KotlinAsset'));
      this.registerExtension('rs', './assets/RustAsset');
    }

    this.registerExtension('css', require('./assets/CSSAsset'));
    this.registerExtension('pcss', require('./assets/CSSAsset'));
    this.registerExtension('postcss', require('./assets/CSSAsset'));
    if (!process.browser) {
      this.registerExtension('sss', require('./assets/SSSAsset'));
      this.registerExtension('styl', require('./assets/StylusAsset'));
      this.registerExtension('stylus', require('./assets/StylusAsset'));
    }
    this.registerExtension('scss', require('./assets/SASSAsset'));
    this.registerExtension('sass', require('./assets/SASSAsset'));
    this.registerExtension('less', require('./assets/LESSAsset'));

    this.registerExtension('html', require('./assets/HTMLAsset'));
    this.registerExtension('htm', require('./assets/HTMLAsset'));

    this.registerExtension('webmanifest', require('./assets/WebManifestAsset'));

    this.registerExtension('glsl', require('./assets/GLSLAsset'));
    this.registerExtension('vert', require('./assets/GLSLAsset'));
    this.registerExtension('frag', require('./assets/GLSLAsset'));

    this.registerExtension('jade', require('./assets/PugAsset'));
    this.registerExtension('pug', require('./assets/PugAsset'));
    this.registerExtension('md', require('./assets/MarkdownAsset'));

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
      try {
        parser = this.extensions[extension] = require(parser);
      } catch (err) {
        let relFilename = path.relative(process.cwd(), filename);
        let relParserName = path.relative(process.cwd(), parser);
        if (relParserName.slice(0, 12) === 'node_modules') {
          relParserName = relParserName.slice(13);
        }
        logger.warn(
          `Parser "${relParserName}" failed to initialize when processing ` +
            `asset "${relFilename}". Threw the following error:\n` +
            `${err.stack || err.message || err} falling back to RawAsset`
        );
        return RawAsset;
      }
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
