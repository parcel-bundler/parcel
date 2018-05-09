const {File: BabelFile} = require('babel-core');
const traverse = require('babel-traverse').default;
const codeFrame = require('babel-code-frame');
const collectDependencies = require('../../visitors/dependencies');
const walk = require('babylon-walk');
const babylon = require('babylon');
const insertGlobals = require('../../visitors/globals');
const fsVisitor = require('../../visitors/fs');
const envVisitor = require('../../visitors/env');
const babel = require('../../transforms/babel');
const generate = require('babel-generator').default;
const uglify = require('../../transforms/uglify');
const SourceMap = require('../../SourceMap');

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const ENV_RE = /\b(?:process\.env)\b/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer|define)\b/;
const FS_RE = /\breadFileSync\b/;
const SW_RE = /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/;
const WORKER_RE = /\bnew\s*Worker\s*\(/;

async function getParserOptions(state) {
  // Babylon options. We enable a few plugins by default.
  const options = {
    filename: state.name,
    allowReturnOutsideFunction: true,
    allowHashBang: true,
    ecmaVersion: Infinity,
    strictMode: false,
    sourceType: 'module',
    locations: true,
    plugins: ['exportExtensions', 'dynamicImport']
  };

  // Check if there is a babel config file. If so, determine which parser plugins to enable
  state.babelConfig = await babel.getConfig(state);
  if (state.babelConfig) {
    const file = new BabelFile(state.babelConfig);
    options.plugins.push(...file.parserOpts.plugins);
  }

  return options;
}

const JSAsset = {
  type: 'js',

  init(name, options, state) {
    state.cacheData.env = {};
    return {
      globals: new Map(),
      isAstDirty: false,
      isES6Module: false,
      outputCode: null,
      sourceMap: options.rendition ? options.rendition.sourceMap : null
    };
  },

  shouldInvalidate(cacheData) {
    this.type = 'js';
    for (let key in cacheData.env) {
      if (cacheData.env[key] !== process.env[key]) {
        return true;
      }
    }

    return false;
  },

  mightHaveDependencies({isAstDirty, name, contents}) {
    return (
      isAstDirty ||
      !/.js$/.test(name) ||
      IMPORT_RE.test(contents) ||
      GLOBAL_RE.test(contents) ||
      SW_RE.test(contents) ||
      WORKER_RE.test(contents)
    );
  },

  async parse(code, state) {
    const options = await getParserOptions(state);
    return babylon.parse(code, options);
  },

  collectDependencies(ast, state) {
    walk.ancestor(ast, collectDependencies, state);
  },

  async pretransform(ast, state) {
    ast = await babel(ast, state);

    // Inline environment variables
    if (ENV_RE.test(state.contents)) {
      await state.parseIfNeeded();
      walk.simple(ast, envVisitor, state);
    }

    return ast;
  },

  async transform(ast, state) {
    if (state.options.target === 'browser') {
      if (state.dependencies.has('fs') && FS_RE.test(state.contents)) {
        // Check if we should ignore fs calls
        // See https://github.com/defunctzombie/node-browser-resolve#skip
        let pkg = await state.getPackage();
        let ignore = pkg && pkg.browser && pkg.browser.fs === false;

        if (!ignore) {
          await state.parseIfNeeded();
          traverse(ast, fsVisitor, null, state);
        }
      }

      if (GLOBAL_RE.test(state.contents)) {
        await state.parseIfNeeded();
        walk.ancestor(ast, insertGlobals, state);
      }
    }

    if (state.isES6Module) {
      ast = await babel(ast, state);
    }

    if (state.options.minify) {
      return uglify(state);
    }

    return ast;
  },

  generateErrorMessage(err, state) {
    const loc = err.loc;
    if (loc) {
      err.codeFrame = codeFrame(state.contents, loc.line, loc.column + 1);
      err.highlightedCodeFrame = codeFrame(
        state.contents,
        loc.line,
        loc.column + 1,
        {highlightCode: true}
      );
    }

    return err;
  },

  async generate(ast, state) {
    let code;
    if (state.isAstDirty) {
      let opts = {
        sourceMaps: state.options.sourceMaps,
        sourceFileName: state.relativeName
      };

      let generated = generate(ast, opts, state.contents);

      if (state.options.sourceMaps && generated.rawMappings) {
        let rawMap = new SourceMap(generated.rawMappings, {
          [state.relativeName]: state.contents
        });

        // Check if we already have a source map (e.g. from TypeScript or CoffeeScript)
        // In that case, we need to map the original source map to the babel generated one.
        if (state.sourceMap) {
          state.sourceMap = await new SourceMap().extendSourceMap(
            state.sourceMap,
            rawMap
          );
        } else {
          state.sourceMap = rawMap;
        }
      }

      code = generated.code;
    } else {
      code = state.outputCode || state.contents;
    }

    if (state.options.sourceMaps && !state.sourceMap) {
      state.sourceMap = new SourceMap().generateEmptyMap(
        state.relativeName,
        state.contents
      );
    }

    if (state.globals.size > 0) {
      code = Array.from(state.globals.values()).join('\n') + '\n' + code;
      if (state.options.sourceMaps) {
        if (!(state.sourceMap instanceof SourceMap)) {
          state.sourceMap = await new SourceMap().addMap(state.sourceMap);
        }

        state.sourceMap.offset(state.globals.size);
      }
    }

    return {
      js: code,
      map: state.sourceMap
    };
  }
};

module.exports = {
  Asset: {
    js: JSAsset
  }
};
