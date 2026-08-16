const path = require('path');
const fs = require('fs');
const Module = require('module');
const {minifySync, parseSync} = require('@swc/core');

// Keep this list limited to JavaScript implementations. Native builtins should be
// omitted here. `request` is resolved with Node's normal package resolution and
// then the package's browser mapping is applied.
const BUILTINS = {
  assert: {request: 'assert/'},
  buffer: {request: 'buffer/'},
  domain: {request: 'domain-browser'},
  events: {request: 'events/'},
  os: {request: 'os-browserify'},
  punycode: {request: 'punycode/'},
  querystring: {request: 'querystring-es3'},
  stream: {request: 'stream-browserify'},
  string_decoder: {request: 'string_decoder/'},
  sys: {request: 'util/'},
  tty: {request: 'tty-browserify'},
  url: {request: 'url/'},
  util: {request: 'util/'},
  zlib: {
    source: path.join(__dirname, 'builtin-src/native-zlib/index.js'),
    packageName: 'native-zlib'
  }
};

// Builtins supplied by the QuickJS host rather than embedded JavaScript.
const HOST_BUILTINS = new Set([
  'base64-js',
  'builtin:zlib-native',
  'buffer-native',
  'console',
  'crypto',
  'fs',
  'fs/promises',
  'path',
  'process',
  'zlib-native'
]);
const EXTERNAL_BUILTINS = new Set([
  ...HOST_BUILTINS,
  ...Module.builtinModules,
  ...Module.builtinModules.map(name => `node:${name}`)
]);

// Post-copy changes live here so native-backed facades can add small JS shims
// without complicating graph discovery.
const POST_COPY_TRANSFORMS = new Map([
  [
    'buffer/index.js',
    source =>
      source +
      `
// Parcel's QuickJS host accelerates byte-oriented operations while this module
// retains Buffer's JavaScript API, validation, and prototype behavior.
;(function () {
  var native = require('buffer-native')
  var originalFrom = Buffer.from
  Buffer.from = function (value, encodingOrOffset, length) {
    if (typeof value === 'string' && typeof encodingOrOffset === 'string') {
      var encoding = encodingOrOffset.toLowerCase()
      if (encoding === 'hex') {
        var result = native.hexDecode(value)
        Object.setPrototypeOf(result, Buffer.prototype)
        return result
      }
      if (encoding === 'base64') {
        var result = base64.toByteArray(base64clean(value))
        Object.setPrototypeOf(result, Buffer.prototype)
        return result
      }
    }
    return originalFrom(value, encodingOrOffset, length)
  }

  var originalToString = Buffer.prototype.toString
  Buffer.prototype.toString = function (encoding, start, end) {
    if (typeof encoding !== 'string' || encoding.toLowerCase() !== 'hex') {
      return originalToString.apply(this, arguments)
    }
    if (start === undefined || start < 0) start = 0
    if (start > this.length) return ''
    if (end === undefined || end > this.length) end = this.length
    if (end <= 0) return ''
    end >>>= 0
    start >>>= 0
    if (end <= start) return ''
    return native.hexEncode(this, start, end)
  }
  Buffer.prototype.toLocaleString = Buffer.prototype.toString

  var originalCompare = Buffer.compare
  Buffer.compare = function (a, b) {
    if (a instanceof Uint8Array && b instanceof Uint8Array) return native.compare(a, b)
    return originalCompare(a, b)
  }
})()
`
  ],
  [
    'util/util.js',
    source => source + '\nexports.TextDecoder = TextDecoder;\nexports.TextEncoder = TextEncoder;\n'
  ]
]);

function normalizePath(file) {
  return file.split(path.sep).join('/');
}

function isRelative(request) {
  return request.startsWith('.') || path.isAbsolute(request);
}

function parseRequires(source, filename) {
  let ast;
  // A leading token gives us a reliable file-local anchor. SWC spans are
  // process-global and Program.span.start otherwise skips leading comments.
  let prefix = '0;\n';
  try {
    ast = parseSync(prefix + source, {syntax: 'ecmascript', script: true});
  } catch (scriptError) {
    try {
      ast = parseSync(prefix + source, {syntax: 'ecmascript'});
    } catch (moduleError) {
      moduleError.message += `\nwhile parsing ${filename}`;
      throw moduleError;
    }
  }

  let requires = [];
  let dynamic = [];
  let base = ast.span.start + Buffer.byteLength(prefix);
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (
      value.type === 'CallExpression' &&
      value.callee &&
      value.callee.type === 'Identifier' &&
      value.callee.value === 'require'
    ) {
      let arg = value.arguments && value.arguments[0];
      if (arg && !arg.spread && arg.expression.type === 'StringLiteral') {
        requires.push({
          request: arg.expression.value,
          start: arg.expression.span.start - base,
          end: arg.expression.span.end - base
        });
      } else {
        dynamic.push(value.span.start - base);
      }
    }

    for (let key of Object.keys(value)) {
      if (key !== 'span') visit(value[key]);
    }
  }
  visit(ast);
  return {requires, dynamic};
}

function rewriteRequires(source, replacements) {
  let input = Buffer.from(source);
  let chunks = [];
  let last = 0;
  for (let replacement of replacements.sort((a, b) => a.start - b.start)) {
    chunks.push(input.subarray(last, replacement.start));
    chunks.push(Buffer.from(JSON.stringify(replacement.request)));
    last = replacement.end;
  }
  chunks.push(input.subarray(last));
  return Buffer.concat(chunks).toString();
}

class BuiltinGraph {
  constructor() {
    this.packageCache = new Map();
    this.directoryPackageCache = new Map();
    this.packageOutputs = new Map();
    this.packageIdentities = new Map();
    this.reservedPackageDirs = new Set();
    this.reservedPackageNames = new Set();
    this.files = new Map();
    this.synthetic = new Map();
    this.dynamicRequires = [];
    this.virtualPackages = new Map();
  }

  packageForFile(file) {
    let dir = path.dirname(file);
    let visited = [];
    while (true) {
      if (this.directoryPackageCache.has(dir)) {
        let pkg = this.directoryPackageCache.get(dir);
        for (let item of visited) this.directoryPackageCache.set(item, pkg);
        return pkg;
      }
      visited.push(dir);
      let packageJson = path.join(dir, 'package.json');
      if (this.virtualPackages.has(dir)) {
        let pkg = this.virtualPackages.get(dir);
        for (let item of visited) this.directoryPackageCache.set(item, pkg);
        return pkg;
      }
      if (fs.existsSync(packageJson) && file.includes(`${path.sep}node_modules${path.sep}`)) {
        let pkg = this.readPackage(packageJson);
        for (let item of visited) this.directoryPackageCache.set(item, pkg);
        return pkg;
      }
      let parent = path.dirname(dir);
      if (parent === dir) throw new Error(`Could not find package for ${file}`);
      dir = parent;
    }
  }

  readPackage(packageJson) {
    packageJson = fs.realpathSync(packageJson);
    if (this.packageCache.has(packageJson)) return this.packageCache.get(packageJson);

    let data = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    let pkg = {
      dir: path.dirname(packageJson),
      packageJson,
      name: data.name,
      data,
      browserModules: new Map(),
      browserPaths: new Map()
    };
    if (!pkg.name) throw new Error(`Package has no name: ${packageJson}`);
    this.packageCache.set(packageJson, pkg);

    let identity = `${pkg.name}@${pkg.data.version || 'unknown'}`;
    let identical = this.packageIdentities.get(identity);
    if (this.reservedPackageDirs.has(pkg.dir)) {
      pkg.outputName = pkg.name;
    } else if (identical && !this.reservedPackageDirs.has(identical.dir)) {
      pkg.outputName = identical.outputName;
    } else if (this.reservedPackageNames.has(pkg.name)) {
      pkg.outputName = normalizePath(path.join('__parcel_deps', identity));
    } else if (!this.packageOutputs.has(pkg.name)) {
      pkg.outputName = pkg.name;
    } else {
      pkg.outputName = normalizePath(path.join('__parcel_deps', identity));
    }
    if (!this.packageOutputs.has(pkg.name)) this.packageOutputs.set(pkg.name, pkg);
    this.packageIdentities.set(identity, pkg);

    let browser = data.browser;
    if (typeof browser === 'string') {
      let main = this.resolvePackageFile(data.main || 'index.js', pkg);
      let replacement = this.resolvePackageFile(browser, pkg);
      pkg.browserPaths.set(main, replacement);
    } else if (browser && typeof browser === 'object') {
      for (let key of Object.keys(browser).sort()) {
        let value = browser[key];
        if (key.startsWith('.')) {
          let source = this.resolveWithoutBrowser(key, packageJson);
          let replacement =
            value === false
              ? false
              : value.startsWith('.')
                ? this.resolveWithoutBrowser(value, packageJson)
                : value;
          pkg.browserPaths.set(source, replacement);
        } else {
          pkg.browserModules.set(key, value);
        }
      }
    }
    return pkg;
  }

  resolvePackageFile(request, pkg) {
    return this.resolveWithoutBrowser(path.resolve(pkg.dir, request), pkg.packageJson);
  }

  resolveWithoutBrowser(request, from) {
    let resolved = Module.createRequire(from).resolve(request);
    if (!path.isAbsolute(resolved)) return {external: resolved};
    return fs.realpathSync(resolved);
  }

  resolve(request, from, seen = new Set()) {
    let key = `${from}\0${request}`;
    if (seen.has(key)) throw new Error(`Circular browser mapping for ${request} from ${from}`);
    seen.add(key);

    let owner = this.packageForFile(from);
    if (!isRelative(request) && owner.browserModules.has(request)) {
      let replacement = owner.browserModules.get(request);
      if (replacement === false) return false;
      if (isRelative(replacement)) {
        return this.applyBrowserPath(this.resolveWithoutBrowser(replacement, owner.packageJson), seen);
      }
      return this.resolve(replacement, owner.packageJson, seen);
    }

    let builtin = BUILTINS[request];
    if (builtin) request = builtin.request;
    else if (HOST_BUILTINS.has(request)) return {external: request};

    let resolved = this.resolveWithoutBrowser(request, from);
    return this.applyBrowserPath(resolved, seen);
  }

  applyBrowserPath(resolved, seen) {
    if (resolved === false || resolved.external) return resolved;
    let targetPackage = this.packageForFile(resolved);
    if (!targetPackage.browserPaths.has(resolved)) return resolved;
    let replacement = targetPackage.browserPaths.get(resolved);
    if (replacement === false) return false;
    if (replacement === resolved) return resolved;
    if (typeof replacement === 'string') {
      if (path.isAbsolute(replacement)) return this.applyBrowserPath(replacement, seen);
      return this.resolve(replacement, targetPackage.packageJson, seen);
    }
    return replacement;
  }

  outputPath(file) {
    let pkg = this.packageForFile(file);
    let relative = path.relative(pkg.dir, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`${file} is outside ${pkg.dir}`);
    }
    return normalizePath(path.join(pkg.outputName, relative));
  }

  add(file) {
    file = fs.realpathSync(file);
    let output = this.outputPath(file);
    if (this.files.has(output)) {
      let previous = this.files.get(output).file;
      if (!fs.readFileSync(previous).equals(fs.readFileSync(file))) {
        throw new Error(`Conflicting copies of embedded module ${output}: ${previous} and ${file}`);
      }
      return output;
    }
    this.files.set(output, {file, source: null});

    let pkg = this.packageForFile(file);

    let extension = path.extname(file);
    if (extension === '.json') return output;
    if (extension !== '.js') {
      throw new Error(`Unsupported embedded module extension ${extension}: ${file}`);
    }

    let source = fs.readFileSync(file, 'utf8');
    let {requires, dynamic} = parseRequires(source, file);
    let replacements = [];
    for (let item of requires) {
      let target;
      try {
        target = this.resolve(item.request, file);
      } catch (error) {
        error.message += `\nrequired by ${file}`;
        throw error;
      }
      if (target && target.external) continue;

      let targetOutput;
      if (target === false) {
        targetOutput = normalizePath(path.join(pkg.outputName, '__parcel_browser_empty.js'));
        this.synthetic.set(targetOutput, 'module.exports = {};\n');
      } else {
        targetOutput = this.add(target);
      }
      let relative = normalizePath(path.relative(path.dirname(output), targetOutput));
      if (!relative.startsWith('.')) relative = './' + relative;
      replacements.push({...item, request: relative});
    }

    if (dynamic.length) {
      this.dynamicRequires.push({file, offsets: dynamic});
    }
    this.files.get(output).source = rewriteRequires(source, replacements);
    return output;
  }

  addRoot(name, config) {
    if (config.source) {
      let source = fs.realpathSync(config.source);
      let dir = path.dirname(source);
      let pkg = {
        dir,
        packageJson: null,
        name: config.packageName,
        outputName: config.packageName,
        data: {name: config.packageName, version: 'local'},
        browserModules: new Map(),
        browserPaths: new Map()
      };
      this.virtualPackages.set(dir, pkg);
      this.directoryPackageCache.set(dir, pkg);
      this.packageOutputs.set(pkg.name, pkg);
      this.packageIdentities.set(`${pkg.name}@local`, pkg);
      let output = this.add(source);
      let publicOutput = normalizePath(path.join(pkg.name, 'index.js'));
      if (output !== publicOutput) {
        let relative = normalizePath(path.relative(path.dirname(publicOutput), output));
        if (!relative.startsWith('.')) relative = './' + relative;
        this.synthetic.set(publicOutput, `module.exports = require(${JSON.stringify(relative)});\n`);
      }
      return;
    }
    let entry = this.resolveWithoutBrowser(config.request, __filename);
    entry = this.applyBrowserPath(entry, new Set());
    if (!entry || entry.external) throw new Error(`Invalid builtin entry ${name}: ${config.request}`);
    let output = this.add(entry);
    let packageName = this.packageForFile(entry).name;
    let publicOutput = normalizePath(path.join(packageName, 'index.js'));
    if (output !== publicOutput) {
      let relative = normalizePath(path.relative(path.dirname(publicOutput), output));
      if (!relative.startsWith('.')) relative = './' + relative;
      this.synthetic.set(publicOutput, `module.exports = require(${JSON.stringify(relative)});\n`);
    }
  }

  reserveRoot(config) {
    if (config.source) return;
    let request = config.request.replace(/\/$/, '');
    let packageJson = Module.createRequire(__filename).resolve(`${request}/package.json`);
    this.reservedPackageDirs.add(fs.realpathSync(path.dirname(packageJson)));
    this.reservedPackageNames.add(JSON.parse(fs.readFileSync(packageJson, 'utf8')).name);
  }
}

function minify(source, file, failed) {
  let opts = {
    compress: true,
    mangle: {toplevel: false, keep_classnames: true},
    sourceMap: false
  };
  let code;
  try {
    ({code} = minifySync(source, opts));
  } catch (error) {
    try {
      ({code} = minifySync(source, {...opts, module: true}));
    } catch (moduleError) {
      failed.push(file);
    }
  }
  return code && code.length < source.length ? code : source;
}

function validateOutput(outputDir) {
  let files = new Set();
  function walk(dir) {
    for (let entry of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      let file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.add(normalizePath(path.relative(outputDir, file)));
    }
  }
  walk(outputDir);

  let errors = [];
  for (let relative of [...files].sort()) {
    let file = path.join(outputDir, relative);
    if (relative.endsWith('.json')) {
      try {
        JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        errors.push(`${relative}: invalid JSON: ${error.message}`);
      }
      continue;
    }
    if (!relative.endsWith('.js')) continue;
    let {requires} = parseRequires(fs.readFileSync(file, 'utf8'), file);
    for (let {request} of requires) {
      if (!isRelative(request)) {
        if (!EXTERNAL_BUILTINS.has(request)) errors.push(`${relative}: unresolved bare require(${request})`);
        continue;
      }
      let target = normalizePath(path.join(path.dirname(relative), request));
      let candidates = path.extname(target) ? [target] : [target + '.js', path.join(target, 'index.js')];
      if (!candidates.some(candidate => files.has(normalizePath(candidate)))) {
        errors.push(`${relative}: missing ${request}`);
      }
    }
  }
  if (errors.length) throw new Error(`Invalid embedded builtin graph:\n${errors.join('\n')}`);
  return files;
}

function buildBuiltins(outputDir = path.join(__dirname, 'builtins'), options = {}) {
  let graph = new BuiltinGraph();
  for (let config of Object.values(BUILTINS)) graph.reserveRoot(config);
  for (let [name, config] of Object.entries(BUILTINS).sort(([a], [b]) => a.localeCompare(b))) {
    graph.addRoot(name, config);
  }

  graph.synthetic.set(
    'constants/index.js',
    `module.exports = ${JSON.stringify(require('constants'), null, 2)};\n`
  );

  fs.rmSync(outputDir, {recursive: true, force: true});
  fs.mkdirSync(outputDir, {recursive: true});

  let outputs = new Map();
  for (let [output, item] of graph.files) {
    let source = item.source == null ? fs.readFileSync(item.file) : item.source;
    outputs.set(output, source);
  }
  for (let [output, source] of graph.synthetic) outputs.set(output, source);

  let before = 0;
  let after = 0;
  let failed = [];
  for (let output of [...outputs.keys()].sort()) {
    let source = outputs.get(output);
    let transform = POST_COPY_TRANSFORMS.get(output);
    if (transform) source = transform(source.toString());
    if (output.endsWith('.js')) {
      source = source.toString();
      before += Buffer.byteLength(source);
      if (options.minify !== false) source = minify(source, output, failed);
      after += Buffer.byteLength(source);
    }
    let target = path.join(outputDir, output);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, source);
  }

  let files = validateOutput(outputDir);
  if (!options.quiet) {
    console.log(
      `builtins: ${files.size} reachable files, minified ${(before / 1e6).toFixed(2)}MB -> ${(after / 1e6).toFixed(2)}MB`
    );
    if (graph.dynamicRequires.length) {
      console.log(
        `builtins: ${graph.dynamicRequires.length} file(s) contain dynamic require calls; their targets cannot be discovered statically`
      );
    }
    if (failed.length) {
      console.log(`builtins: could not minify ${failed.length} file(s), kept as-is: ${failed.join(', ')}`);
    }
  }
  return {files, dynamicRequires: graph.dynamicRequires};
}

if (require.main === module) buildBuiltins();

module.exports = {
  BUILTINS,
  buildBuiltins,
  parseRequires,
  rewriteRequires,
  validateOutput
};
