const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const {
  BUILTINS,
  buildBuiltins,
  parseRequires,
  rewriteRequires,
  validateOutput
} = require('./buildBuiltins.cjs');

function digestTree(dir) {
  let hash = crypto.createHash('sha256');
  for (let file of [...validateOutput(dir)].sort()) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(dir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

test('static require spans can be rewritten in unicode source', () => {
  let source = "const snowman = '☃'; module.exports = require('./server');";
  let {requires, dynamic} = parseRequires(source, 'fixture.js');
  assert.deepEqual(dynamic, []);
  assert.equal(requires.length, 1);
  assert.equal(
    rewriteRequires(source, [{...requires[0], request: './browser.js'}]),
    "const snowman = '☃'; module.exports = require(\"./browser.js\");"
  );
});

test('reachable builtin output is deterministic and self-contained', () => {
  let temp = fs.mkdtempSync(path.join(os.tmpdir(), 'parcel-plugin-js-builtins-'));
  let first = path.join(temp, 'first');
  let second = path.join(temp, 'second');
  try {
    let a = buildBuiltins(first, {minify: false, quiet: true});
    let b = buildBuiltins(second, {minify: false, quiet: true});
    assert.equal(digestTree(first), digestTree(second));
    assert.deepEqual([...a.files].sort(), [...b.files].sort());

    // These used to be copied recursively even though no builtin can reach them.
    assert.equal([...a.files].some(file => /\/(?:test|tests|example|examples)\//.test(file)), false);
    if (BUILTINS.zlib && BUILTINS.zlib.request === 'browserify-zlib') {
      assert.equal(a.files.has('pako/dist/pako.js'), false);
    }
    if (BUILTINS.zlib && BUILTINS.zlib.packageName === 'native-zlib') {
      assert.equal(a.files.has('native-zlib/index.js'), true);
      assert.equal([...a.files].some(file => file.startsWith('pako/')), false);
    }
    // This package was accidentally dropped by the old `/test/` path filter.
    if (BUILTINS.crypto && BUILTINS.crypto.request === 'crypto-browserify') {
      assert.equal(a.files.has('evp_bytestokey/index.js'), true);
    }
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
});

test('generated Buffer facade dispatches hex and comparison work to the native extension', () => {
  let temp = fs.mkdtempSync(path.join(os.tmpdir(), 'parcel-plugin-js-buffer-'));
  try {
    buildBuiltins(temp, {minify: false, quiet: true});
    let filename = path.join(temp, 'buffer/index.js');
    let calls = [];
    let native = {
      hexDecode(value) {
        calls.push('hexDecode');
        return Uint8Array.from(Buffer.from(value, 'hex'));
      },
      hexEncode(value, start, end) {
        calls.push(['hexEncode', start, end]);
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
          .subarray(start, end)
          .toString('hex');
      },
      compare(a, b) {
        calls.push('compare');
        return Buffer.compare(a, b);
      }
    };
    let generated = new Module(filename, module);
    generated.filename = filename;
    generated.paths = Module._nodeModulePaths(path.dirname(filename));
    let normalRequire = Module.createRequire(filename);
    generated.require = request => {
      if (request === 'buffer-native') return native;
      return request.startsWith('.') ? normalRequire(request) : require(request);
    };
    generated._compile(fs.readFileSync(filename, 'utf8'), filename);

    let GeneratedBuffer = generated.exports.Buffer;
    let value = GeneratedBuffer.from('00ff10', 'HEX');
    assert.equal(GeneratedBuffer.isBuffer(value), true);
    assert.equal(value.toString('hex', -10, 2), '00ff');
    assert.equal(GeneratedBuffer.compare(value, Uint8Array.from([0, 255, 17])), -1);
    assert.deepEqual(calls, ['hexDecode', ['hexEncode', 0, 2], 'compare']);
    assert.throws(() => GeneratedBuffer.compare(value, 'not bytes'), TypeError);
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
});
