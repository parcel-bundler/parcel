const path = require('path');
const fs = require('fs');
const Module = require('module');

const BUILTINS = {
  assert: 'assert/',
  buffer: 'buffer/',
  crypto: 'crypto-browserify',
  domain: 'domain-browser',
  events: 'events/',
  os: 'os-browserify',
  path: 'path-browserify',
  punycode: 'punycode/',
  querystring: 'querystring-es3',
  stream: 'stream-browserify',
  string_decoder: 'string_decoder/',
  sys: 'util/',
  tty: 'tty-browserify',
  url: 'url/',
  util: 'util/',
  zlib: 'browserify-zlib'
};

let dirs = new Set();
function addModule(module, from = __filename) {
  let req = Module.createRequire(from);
  let resolved = req.resolve(module + '/package.json');
  let dir = path.dirname(resolved);
  if (dirs.has(dir)) return;
  dirs.add(dir);

  let pkg = req(module + '/package.json');
  for (let dep in pkg.dependencies || {}) {
    addModule(dep, resolved);
  }
}

for (let builtin in BUILTINS) {
  addModule(BUILTINS[builtin]);
}

fs.rmSync(__dirname + '/builtins', {recursive: true, force: true});
fs.mkdirSync(__dirname + '/builtins');

for (let dir of dirs) {
  let target = __dirname + '/builtins/' + path.basename(dir);
  fs.cpSync(dir, target, {
    recursive: true,
    filter: src => !/test|\.md|\.markdown|LICENSE|\.yml|\.gitignore|\.npmignore|\.github|\.eslint|\.nycrc|\.d.ts|\.editorconfig|tsconfig|yarn\.lock|karma\.config|package\.json|\.sh/.test(src) && src.match(/node_modules/g).length <= dir.match(/node_modules/g).length
  });

  let pkg = JSON.parse(fs.readFileSync(dir + '/package.json'));
  let main = pkg.browser || pkg.main;
  if (typeof main === 'object') {
    main = main[pkg.main] || pkg.main;
  }
  if (main && main !== 'index.js' && main !== './index.js' && main !== './index' && main !== 'index') {
    if (!main.startsWith('.')) {
      main = './' + main;
    }
    fs.writeFileSync(target + '/index.js', 'module.exports = require("' + main + '");\n');
  }
}

fs.mkdirSync(__dirname + '/builtins/constants');
fs.writeFileSync(__dirname + '/builtins/constants/index.js', `module.exports = ${JSON.stringify(require('constants'), null, 2)};\n`);
fs.writeFileSync(__dirname + '/builtins/util/util.js', fs.readFileSync(__dirname + '/builtins/util/util.js', 'utf8') + '\nexports.TextDecoder = TextDecoder;\nexports.TextEncoder = TextEncoder;\n');

// These files are embedded in the binary (see `Builtins` in src/cjs.rs), so minify
// them. Top-level names are left alone: each module is evaluated inside a CommonJS
// wrapper, and some of these packages depend on `fn.name` / `constructor.name`.
const {minifySync} = require('@swc/core');

function walk(dir, out = []) {
  for (let entry of fs.readdirSync(dir, {withFileTypes: true})) {
    let p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

let before = 0;
let after = 0;
let failed = [];
for (let file of walk(__dirname + '/builtins')) {
  let source = fs.readFileSync(file, 'utf8');
  before += source.length;
  let opts = {
    compress: true,
    mangle: {toplevel: false, keep_classnames: true},
    sourceMap: false
  };
  let code;
  try {
    ({code} = minifySync(source, opts));
  } catch (err) {
    try {
      // A few of these ship an ESM build, which won't parse as a script.
      ({code} = minifySync(source, {...opts, module: true}));
    } catch (err2) {
      failed.push(path.relative(__dirname, file));
    }
  }
  // Fall back to the original if minification failed or made the file bigger.
  if (code && code.length < source.length) {
    fs.writeFileSync(file, code);
    after += code.length;
  } else {
    after += source.length;
  }
}

console.log(`builtins: minified ${(before / 1e6).toFixed(2)}MB -> ${(after / 1e6).toFixed(2)}MB`);
if (failed.length) {
  console.log(`builtins: could not minify ${failed.length} file(s), kept as-is: ${failed.join(', ')}`);
}
