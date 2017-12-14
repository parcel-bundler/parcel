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
const fs = require('fs');
const Logger = require('../Logger');

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer)\b/;
const FS_RE = /\breadFileSync\b/;

const logger = new Logger({});

class JSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
    this.globals = new Map();
    this.isAstDirty = false;
    this.isES6Module = false;
    this.outputCode = null;

    // decode .env
    this.envTable = {};
    const envRegex = /^(\w+)\s*=\s*([\s\S]+)/;
    const envFile =
      process.env.NODE_ENV === 'development' ? ['.dev.env'] : ['.env'];
    (async () => {
      const envPath = await config.resolve(this.name, envFile);
      const env = envPath && fs.readFileSync(envPath, {encoding: 'utf8'});
      env &&
        env.split(/\n+/).forEach(line => {
          let matches = null;
          if (!(matches = line.match(envRegex))) {
            return;
          }
          this.envTable[matches[1]] = matches[2];
        });
    })().catch(err => {
      this.logger.warn(err);
    });
  }

  mightHaveDependencies() {
    return (
      !/.js$/.test(this.name) ||
      IMPORT_RE.test(this.contents) ||
      GLOBAL_RE.test(this.contents)
    );
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
      plugins: ['exportExtensions', 'dynamicImport']
    };

    for (let envName in this.envTable) {
      const envReplaceRegex = new RegExp(`process\\.env\\.${envName}`, 'gi');
      code = code.replace(envReplaceRegex, `'${this.envTable[envName]}'`);
    }

    // Check if there is a babel config file. If so, determine which parser plugins to enable
    this.babelConfig =
      (this.package && this.package.babel) ||
      (await config.load(this.name, ['.babelrc', '.babelrc.js']));
    if (this.babelConfig) {
      const file = new BabelFile({filename: this.name});
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
