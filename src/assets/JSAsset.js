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
const SourceMap = require('../SourceMap');

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer)\b/;
const FS_RE = /\breadFileSync\b/;
const SW_RE = /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/;
const WORKER_RE = /\bnew\s*Worker\s*\(/;

class JSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'js';
    this.globals = new Map();
    this.isAstDirty = false;
    this.isES6Module = false;
    this.outputCode = null;
    this.cacheData.env = {};
    this.sourceMap = options.rendition ? options.rendition.sourceMap : null;
  }

  shouldInvalidate(cacheData) {
    for (let key in cacheData.env) {
      if (cacheData.env[key] !== process.env[key]) {
        return true;
      }
    }

    return false;
  }

  mightHaveDependencies() {
    return (
      this.isAstDirty ||
      !/.js$/.test(this.name) ||
      IMPORT_RE.test(this.contents) ||
      GLOBAL_RE.test(this.contents) ||
      SW_RE.test(this.contents) ||
      WORKER_RE.test(this.contents)
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
    this.babelConfig = await babel.getConfig(this);
    if (this.babelConfig) {
      const file = new BabelFile(this.babelConfig);
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
    walk.ancestor(this.ast, collectDependencies, this);
  }

  async pretransform() {
    await babel(this);
  }

  async transform() {
    if (this.options.target === 'browser') {
      if (this.dependencies.has('fs') && FS_RE.test(this.contents)) {
        await this.parseIfNeeded();
        this.traverse(fsVisitor);
      }

      if (GLOBAL_RE.test(this.contents)) {
        await this.parseIfNeeded();
        walk.ancestor(this.ast, insertGlobals, this);
      }
    }

    if (this.isES6Module) {
      await babel(this);
    }

    if (this.options.minify) {
      await uglify(this);
    }
  }

  async generate() {
    let code;
    if (this.isAstDirty) {
      let opts = {
        sourceMaps: this.options.sourceMaps,
        sourceFileName: this.relativeName
      };

      let generated = generate(this.ast, opts, this.contents);

      if (this.options.sourceMaps && generated.rawMappings) {
        let rawMap = new SourceMap(generated.rawMappings, {
          [this.relativeName]: this.contents
        });

        // Check if we already have a source map (e.g. from TypeScript or CoffeeScript)
        // In that case, we need to map the original source map to the babel generated one.
        if (this.sourceMap) {
          this.sourceMap = await new SourceMap().extendSourceMap(
            this.sourceMap,
            rawMap
          );
        } else {
          this.sourceMap = rawMap;
        }
      }

      code = generated.code;
    } else {
      code = this.outputCode || this.contents;
    }

    if (this.options.sourceMaps && !this.sourceMap) {
      this.sourceMap = new SourceMap().generateEmptyMap(
        this.relativeName,
        this.contents
      );
    }

    if (this.globals.size > 0) {
      code = Array.from(this.globals.values()).join('\n') + '\n' + code;
      if (this.options.sourceMaps) {
        if (!(this.sourceMap instanceof SourceMap)) {
          this.sourceMap = await new SourceMap().addMap(this.sourceMap);
        }

        this.sourceMap.offset(this.globals.size);
      }
    }

    return {
      js: code,
      map: this.sourceMap
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
