const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {bundler, run, assertBundleTree, sleep} = require('./utils');
const rimraf = require('rimraf');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));
const WebSocket = require('ws');
const json5 = require('json5');

describe('hmr', function() {
  let b, ws;
  beforeEach(function() {
    rimraf.sync(__dirname + '/input');
  });

  afterEach(function() {
    if (b) {
      b.stop();
      b = null;
    }

    if (ws) {
      ws.close();
      ws = null;
    }
  });

  function nextEvent(emitter, event) {
    return new Promise(resolve => {
      emitter.once(event, resolve);
    });
  }

  it('should emit an HMR update for the file that changed', async function() {
    await ncp(__dirname + '/integration/commonjs', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'exports.a = 5; exports.b = 5;'
    );

    let msg = json5.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'update');
    assert.equal(msg.assets.length, 1);
    assert.equal(msg.assets[0].generated.js, 'exports.a = 5; exports.b = 5;');
    assert.deepEqual(msg.assets[0].deps, {});
  });

  it('should emit an HMR update for all new dependencies along with the changed file', async function() {
    await ncp(__dirname + '/integration/commonjs', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'require("fs"); exports.a = 5; exports.b = 5;'
    );

    let msg = json5.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'update');
    assert.equal(msg.assets.length, 2);
  });

  it('should emit an HMR error on bundle failure', async function() {
    await ncp(__dirname + '/integration/commonjs', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );

    let msg = JSON.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'error');
    assert.equal(
      msg.error.message,
      `${path.join(
        __dirname,
        '/input/local.js'
      )}:1:12: Unexpected token, expected , (1:12)`
    );
    assert.equal(
      msg.error.stack,
      '> 1 | require("fs"; exports.a = 5; exports.b = 5;\n    |             ^'
    );
  });

  it('should emit an HMR error to new connections after a bundle failure', async function() {
    await ncp(__dirname + '/integration/commonjs', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');
    await sleep(50);

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);
    let msg = JSON.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'error');
  });

  it('should emit an HMR error-resolved on build after error', async function() {
    await ncp(__dirname + '/integration/commonjs', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );

    let msg = JSON.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'error');

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'require("fs"); exports.a = 5; exports.b = 5;'
    );

    let msg2 = JSON.parse(await nextEvent(ws, 'message'));
    assert.equal(msg2.type, 'error-resolved');
  });

  it('should accept HMR updates in the runtime', async function() {
    await ncp(__dirname + '/integration/hmr', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();
    let outputs = [];

    run(bundle, {
      output(o) {
        outputs.push(o);
      }
    });

    assert.deepEqual(outputs, [3]);

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'exports.a = 5; exports.b = 5;'
    );

    await nextEvent(b, 'bundled');
    assert.deepEqual(outputs, [3, 10]);
  });

  it('should call dispose and accept callbacks', async function() {
    await ncp(__dirname + '/integration/hmr-callbacks', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();
    let outputs = [];

    run(bundle, {
      output(o) {
        outputs.push(o);
      }
    });

    assert.deepEqual(outputs, [3]);

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'exports.a = 5; exports.b = 5;'
    );

    await nextEvent(b, 'bundled');
    assert.deepEqual(outputs, [3, 'dispose', 10, 'accept']);
  });

  it('should work across bundles', async function() {
    await ncp(__dirname + '/integration/hmr-dynamic', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();
    let outputs = [];

    run(bundle, {
      output(o) {
        outputs.push(o);
      }
    });

    await sleep(50);
    assert.deepEqual(outputs, [3]);

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'exports.a = 5; exports.b = 5;'
    );

    await nextEvent(b, 'bundled');
    await sleep(50);
    assert.deepEqual(outputs, [3, 10]);
  });

  it('should log emitted errors', async function() {
    await ncp(__dirname + '/integration/commonjs', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();

    let logs = [];
    run(bundle, {
      console: {
        error(msg) {
          logs.push(msg);
        }
      }
    });

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');
    await sleep(50);

    assert.equal(logs.length, 1);
    assert(logs[0].trim().startsWith('[parcel] 🚨'));
  });

  it('should log when errors resolve', async function() {
    await ncp(__dirname + '/integration/commonjs', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true, hmr: true});
    let bundle = await b.bundle();

    let logs = [];
    run(bundle, {
      console: {
        error(msg) {
          logs.push(msg);
        },
        log(msg) {
          logs.push(msg);
        }
      }
    });

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'require("fs"); exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');
    await sleep(50);

    assert.equal(logs.length, 2);
    assert(logs[0].trim().startsWith('[parcel] 🚨'));
    assert(logs[1].trim().startsWith('[parcel] ✨'));
  });
});
