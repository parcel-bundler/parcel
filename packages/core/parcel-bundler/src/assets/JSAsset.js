const {File: BabelFile} = require('babel-core');
const traverse = require('babel-traverse').default;
const collectDependencies = require('../visitors/dependencies');
const walk = require('babylon-walk');
const Asset = require('../Asset');
const babylon = require('babylon');
const insertGlobals = require('../visitors/globals');
const babel = require('../transforms/babel');
const generate = require('babel-generator').default;
const uglify = require('../transforms/uglify');
const config = require('../utils/config');

const IMPORT_RE = /\b(?:import\b|export [^;]* from|require\s*\()/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer)\b/;

class JSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
    this.globals = new Map;
    this.isAstDirty = false;
  }

  mightHaveDependencies() {
    return IMPORT_RE.test(this.contents) || GLOBAL_RE.test(this.contents);
  }

  async parse(code) {
    // Babylon options. We enable a few plugins by default.
    const options = {
      filename: this.name,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      ecmaVersion: Infinity,
      strictMode: false,
      sourceType: 'module',
      locations: true,
      plugins: [
        'exportExtensions',
        'dynamicImport'
      ]
    };

    // Check if there is a babel config file. If so, determine which parser plugins to enable
    this.babelConfig = (this.package && this.package.babel) || await config.load(this.name, ['.babelrc', '.babelrc.js']);
    if (this.babelConfig) {
      this.babelConfig.babelrc = false; // We already loaded the babelrc
      const file = new BabelFile(this.babelConfig);
      options.plugins.push(...file.parserOpts.plugins);
    }

    return babylon.parse(code, options);
  }

  traverse(visitor) {
    return traverse(this.ast, visitor, null, this);
  }

  traverseFast(visitor) {
    return walk.simple(this.ast, visitor, this);
  }

  collectDependencies() {
    this.traverseFast(collectDependencies);
  }

  async transform() {
    if (GLOBAL_RE.test(this.contents)) {
      walk.ancestor(this.ast, insertGlobals, this);
    }

    await babel(this);

    if (this.options.minify) {
      await uglify(this);
    }
  }

  generate() {
    // TODO: source maps
    let code = this.isAstDirty ? generate(this.ast).code : this.contents;
    if (this.globals.size > 0) {
      code = Array.from(this.globals.values()).join('\n') + '\n' + code;
    }

    return {
      js: code
    };
  }
}

module.exports = JSAsset;
