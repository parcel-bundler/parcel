const traverse = require('babel-traverse').default;
const collectDependencies = require('../visitors/dependencies');
const walk = require('babylon-walk');
const Asset = require('../Asset');
const babylon = require('babylon');
const insertGlobals = require('../visitors/globals');
const babel = require('../transforms/babel');
const generate = require('babel-generator').default;

const IMPORT_RE = /import |export [^;]* from|require\s*\(/;
const GLOBAL_RE = /process|__dirname|__filename|global|Buffer/;

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

  parse(code) {
    const options = {
      filename: this.name,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      ecmaVersion: Infinity,
      strictMode: false,
      sourceType: 'module',
      locations: true,
      plugins: [
        'asyncFunctions',
        'asyncGenerators',
        'classConstructorCall',
        'classProperties',
        'decorators',
        'exportExtensions',
        'jsx',
        'flow'
      ]
    };

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
  }

  generate() {
    // TODO: source maps
    let code = this.isAstDirty ? generate(this.ast).code : this.contents;
    code = Array.from(this.globals.values()).join('\n') + '\n' + code;
    return {
      js: code
    };
  }
}

module.exports = JSAsset;
