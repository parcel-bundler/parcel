const {File: BabelFile} = require('babel-core');
const traverse = require('babel-traverse').default;
const codeFrame = require('babel-code-frame');
const collectDependencies = require('../visitors/dependencies');
const walk = require('babylon-walk');
const Asset = require('../Asset');
const babylon = require('babylon');
const insertGlobals = require('../visitors/globals');
const fsVisitor = require('../visitors/fs');
const babel = require('../transforms/babel');
const generate = require('babel-generator').default;
const uglify = require('../transforms/uglify');
const config = require('../utils/config');

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer)\b/;
const FS_RE = /\breadFileSync\b/;

class JSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
    this.globals = new Map();
    this.isAstDirty = false;
    this.isES6Module = false;
    this.outputCode = null;
  }

  mightHaveDependencies() {
    return (
      !/.js$/.test(this.name) ||
      IMPORT_RE.test(this.contents) ||
      GLOBAL_RE.test(this.contents)
    );
  }

  async getParserOptions() {
    // Babylon options. We enable a few plugins by default.
    const options = {
      filename: this.name,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      ecmaVersion: Infinity,
      strictMode: false,
      sourceType: 'module',
      locations: true,
      plugins: ['exportExtensions', 'dynamicImport']
    };

    // Check if there is a babel config file. If so, determine which parser plugins to enable
    this.babelConfig =
      (this.package && this.package.babel) ||
      (await config.load(this.name, ['.babelrc', '.babelrc.js']));
    if (this.babelConfig) {
      const file = new BabelFile({filename: this.name});
      options.plugins.push(...file.parserOpts.plugins);
    }

    return options;
  }

  async parse(code) {
    const options = await this.getParserOptions();

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

  async pretransform() {
    await babel(this);
  }

  async transform() {
    if (this.dependencies.has('fs') && FS_RE.test(this.contents)) {
      await this.parseIfNeeded();
      this.traverse(fsVisitor);
    }

    if (GLOBAL_RE.test(this.contents)) {
      await this.parseIfNeeded();
      walk.ancestor(this.ast, insertGlobals, this);
    }

    if (this.isES6Module) {
      await babel(this);
    }

    if (this.options.minify) {
      await uglify(this);
    }
  }

  generate() {
    // TODO: source maps
    let code = this.isAstDirty
      ? generate(this.ast).code
      : this.outputCode || this.contents;
    if (this.globals.size > 0) {
      code = Array.from(this.globals.values()).join('\n') + '\n' + code;
    }

    return {
      js: code
    };
  }

  generateErrorMessage(err) {
    const loc = err.loc;
    if (loc) {
      err.codeFrame = codeFrame(this.contents, loc.line, loc.column + 1);
      err.highlightedCodeFrame = codeFrame(
        this.contents,
        loc.line,
        loc.column + 1,
        {highlightCode: true}
      );
    }

    return err;
  }
}

module.exports = JSAsset;
