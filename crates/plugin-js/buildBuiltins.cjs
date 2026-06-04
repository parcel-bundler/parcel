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
