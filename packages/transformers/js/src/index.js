import semver from 'semver';
import generate from 'babel-generator';
import {transformer} from '@parcel/plugin';
import collectDependencies from './visitors/dependencies';

// Can't import these
const babylon = require('babylon');
const walk = require('babylon-walk');

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const SW_RE = /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/;
const WORKER_RE = /\bnew\s*Worker\s*\(/;

// Sourcemap extraction
// const SOURCEMAP_RE = /\/\/\s*[@#]\s*sourceMappingURL\s*=\s*([^\s]+)/;
// const DATA_URL_RE = /^data:[^;]+(?:;charset=[^;]+)?;base64,(.*)/;

function canHaveDependencies(code) {
  return IMPORT_RE.test(code) || SW_RE.test(code) || WORKER_RE.test(code);
}

export default transformer({
  async canReuseAST(ast) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^6.0.0');
  },

  async parse(module /*, config , options */) {
    if (!canHaveDependencies(module.code)) return null;
    return {
      type: 'babel',
      version: '6.0.0',
      program: babylon.parse(module.code, {
        filename: this.filePath,
        allowReturnOutsideFunction: true,
        allowHashBang: true,
        ecmaVersion: Infinity,
        strictMode: false,
        sourceType: 'module',
        locations: true,
        plugins: ['exportExtensions', 'dynamicImport']
      })
    };
  },

  async transform(module, config /*, options */) {
    if (!module.ast) {
      return [module];
    }

    walk.ancestor(module.ast.program, collectDependencies, {
      module,
      config
    });

    // Do some transforms
    return [module];
  },

  async generate(module, config, options) {
    let generated = generate(
      module.ast.program,
      {
        sourceMaps: options.sourceMaps,
        sourceFileName: module.relativeName
      },
      module.code
    );

    return {
      code: generated.code,
      map: generated.map
    };
  }
});
