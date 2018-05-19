const {File: BabelFile} = require('babel-core');
const traverse = require('babel-traverse').default;
const codeFrame = require('babel-code-frame');
const collectDependencies = require('../visitors/dependencies');
const walk = require('babylon-walk');
const Asset = require('../Asset');
const babylon = require('babylon');
const insertGlobals = require('../visitors/globals');
const fsVisitor = require('../visitors/fs');
const envVisitor = require('../visitors/env');
const babel = require('../transforms/babel');
const generate = require('babel-generator').default;
const uglify = require('../transforms/uglify');
const SourceMap = require('../SourceMap');
const hoist = require('../visitors/hoist');

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const ENV_RE = /\b(?:process\.env)\b/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer|define)\b/;
const FS_RE = /\breadFileSync\b/;
const SW_RE = /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/;
const WORKER_RE = /\bnew\s*Worker\s*\(/;

class JSAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
    this.globals = new Map();
    this.isAstDirty = false;
    this.isES6Module = false;
    this.outputCode = null;
    this.cacheData.env = {};
    this.rendition = options.rendition;
    this.sourceMap = this.rendition ? this.rendition.sourceMap : null;
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

    // Inline environment variables
    if (this.options.target === 'browser' && ENV_RE.test(this.contents)) {
      await this.parseIfNeeded();
      this.traverseFast(envVisitor);
    }
  }

  async transform() {
    if (this.options.target === 'browser') {
      if (this.dependencies.has('fs') && FS_RE.test(this.contents)) {
        // Check if we should ignore fs calls
        // See https://github.com/defunctzombie/node-browser-resolve#skip
        let pkg = await this.getPackage();
        let ignore = pkg && pkg.browser && pkg.browser.fs === false;

        if (!ignore) {
          await this.parseIfNeeded();
          this.traverse(fsVisitor);
        }
      }

      if (GLOBAL_RE.test(this.contents)) {
        await this.parseIfNeeded();
        walk.ancestor(this.ast, insertGlobals, this);
      }
    }

    if (this.options.scopeHoist) {
      await this.parseIfNeeded();
      await this.getPackage();

      this.traverse(hoist);
      this.isAstDirty = true;

      // let asset = this;
      // let plugin = function () {
      //   return {
      //     visitor: {
      //       Program(path) {
      //         // path.traverse(hoist, asset);
      //         asset.traverse(hoist);
      //         path.stop();
      //       }
      //     }
      //   }
      // }

      if (this.contents.includes('createListView')) {
        console.log((await this.generate()).js);
      }

      // if (this.options.minify) {
        // await uglify(this);
        let res = require('babel-core').transformFromAst(this.ast, this.contents, {
          babelrc: false,
          code: false,
          filename: 'jhi',
          // plugins: [plugin],
          presets: [[require('babel-preset-minify'), {
            // mangle: true,
            deadcode: false
          }]]
        });

        this.ast = res.ast;
        this.isAstDirty = true;
      // }
    } else {
      if (this.isES6Module) {
        await babel(this);
      }

      // We minify in the Packager if scope hoisting is enabled
      if (this.options.minify) {
        await uglify(this);
      }
    }
  }

  async generate() {
    let enableSourceMaps =
      this.options.sourceMaps &&
      (!this.rendition || !!this.rendition.sourceMap);
    let code;
    if (this.isAstDirty) {
      let opts = {
        sourceMaps: this.options.sourceMaps,
        sourceFileName: this.relativeName,
        minified: true,
        comments: false
      };

      let generated = generate(this.ast, opts, this.contents);

      if (enableSourceMaps && generated.rawMappings) {
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
      code = this.outputCode != null ? this.outputCode : this.contents;
    }

    if (enableSourceMaps && !this.sourceMap) {
      this.sourceMap = new SourceMap().generateEmptyMap(
        this.relativeName,
        this.contents
      );
    }

    if (this.globals.size > 0) {
      code = Array.from(this.globals.values()).join('\n') + '\n' + code;
      if (enableSourceMaps) {
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
