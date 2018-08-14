const semver = require('semver');
const babylon = require('babylon');
const generate = require('babel-generator').default;
const walk = require('babylon-walk');
const collectDependencies = require('./visitors/dependencies');

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const SW_RE = /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/;
const WORKER_RE = /\bnew\s*Worker\s*\(/;

// Sourcemap extraction
const SOURCEMAP_RE = /\/\/\s*[@#]\s*sourceMappingURL\s*=\s*([^\s]+)/;
const DATA_URL_RE = /^data:[^;]+(?:;charset=[^;]+)?;base64,(.*)/;

function canHaveDependencies(code) {
  return IMPORT_RE.test(code) ||
    SW_RE.test(code) ||
    WORKER_RE.test(code);
}

exports.canReuseAST = async function(ast) {
  return ast.type === 'babel' && semver.satisfies(ast.version, '^6.0.0');
}

exports.parse = async function(module, config, options) {
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
}

exports.transform = async function(module, config, options) {
  if (!module.ast) {
    return [module];
  }

  walk.ancestor(module.ast.program, collectDependencies, {
    module,
    config
  });

  // Do some transforms
  return [module];
}

exports.generate = async function(module, config, options) {
  let generated = generate(module.ast.program, {
    sourceMaps: options.sourceMaps,
    sourceFileName: module.relativeName
  }, module.code);

  return {
    code: generated.code,
    map: generated.map
  };
}
