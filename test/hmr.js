const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {bundler, run, sleep, calculateTestKey} = require('./utils');
const rimraf = require('rimraf');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));
const WebSocket = require('ws');
const json5 = require('json5');

describe('hmr', function() {
  let b, ws;
  beforeEach(function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.currentTest)}`;
    rimraf.sync(inputDir);
  });

  afterEach(function(done) {
    let finalise = () => {
      if (b) {
        b.stop();
        b = null;

        done();
      }
    };

    if (ws) {
      ws.close();
      ws.onclose = () => {
        ws = null;
        finalise();
      };
    } else {
      finalise();
    }
  });

  function nextEvent(emitter, event) {
    return new Promise(resolve => {
      emitter.once(event, resolve);
    });
  }

  it('should emit an HMR update for the file that changed', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/commonjs', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
    await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    const buildEnd = nextEvent(b, 'buildEnd');

    fs.writeFileSync(inputDir + '/local.js', 'exports.a = 5;\nexports.b = 5;');

    let msg = json5.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'update');
    assert.equal(msg.assets.length, 1);
    assert.equal(msg.assets[0].generated.js, 'exports.a = 5;\nexports.b = 5;');
    assert.deepEqual(msg.assets[0].deps, {});

    await buildEnd;
  });

  it('should not enable HMR for --target=node', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/commonjs', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true,
      target: 'node'
    });
    await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    let err = await nextEvent(ws, 'error');
    assert(err);
    ws = null;
  });

  it('should enable HMR for --target=electron', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/commonjs', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true,
      target: 'electron'
    });
    await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    const buildEnd = nextEvent(b, 'buildEnd');

    fs.writeFileSync(inputDir + '/local.js', 'exports.a = 5; exports.b = 5;');

    let msg = json5.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'update');
    assert.equal(msg.assets.length, 1);
    assert.equal(msg.assets[0].generated.js, 'exports.a = 5; exports.b = 5;');
    assert.deepEqual(msg.assets[0].deps, {});

    await buildEnd;
  });

  it('should emit an HMR update for all new dependencies along with the changed file', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/commonjs', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
    await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    const buildEnd = nextEvent(b, 'buildEnd');

    fs.writeFileSync(
      inputDir + '/local.js',
      'require("fs"); exports.a = 5; exports.b = 5;'
    );

    let msg = json5.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'update');
    assert.equal(msg.assets.length, 2);

    await buildEnd;
  });

  it('should emit an HMR error on bundle failure', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/commonjs', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
    await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    const buildEnd = nextEvent(b, 'buildEnd');

    fs.writeFileSync(
      inputDir + '/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );

    let msg = JSON.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'error');
    assert.equal(
      msg.error.message,
      `${path.join(
        inputDir,
        '/local.js'
      )}:1:12: Unexpected token, expected , (1:12)`
    );
    assert.equal(
      msg.error.stack,
      '> 1 | require("fs"; exports.a = 5; exports.b = 5;\n    |             ^'
    );

    await buildEnd;
  });

  it('should emit an HMR error to new connections after a bundle failure', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/commonjs', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
    await b.bundle();

    fs.writeFileSync(
      inputDir + '/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');
    await sleep(50);

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);
    let msg = JSON.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'error');
  });

  it('should emit an HMR error-resolved on build after error', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/commonjs', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
    await b.bundle();

    ws = new WebSocket('ws://localhost:' + b.options.hmrPort);

    const firstBuildEnd = nextEvent(b, 'buildEnd');

    fs.writeFileSync(
      inputDir + '/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );

    let msg = JSON.parse(await nextEvent(ws, 'message'));
    assert.equal(msg.type, 'error');

    await firstBuildEnd;

    const secondBuildEnd = nextEvent(b, 'buildEnd');

    fs.writeFileSync(
      inputDir + '/local.js',
      'require("fs"); exports.a = 5; exports.b = 5;'
    );

    let msg2 = JSON.parse(await nextEvent(ws, 'message'));
    assert.equal(msg2.type, 'error-resolved');

    await secondBuildEnd;
  });

  it('should accept HMR updates in the runtime', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/hmr', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
    let bundle = await b.bundle();
    let outputs = [];

    run(bundle, {
      output(o) {
        outputs.push(o);
      }
    });

    assert.deepEqual(outputs, [3]);

    fs.writeFileSync(inputDir + '/local.js', 'exports.a = 5; exports.b = 5;');

    await nextEvent(b, 'bundled');
    assert.deepEqual(outputs, [3, 10]);
  });

  it('should call dispose and accept callbacks', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/hmr-callbacks', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
    let bundle = await b.bundle();
    let outputs = [];
    let moduleId = '';

    run(bundle, {
      reportModuleId(id) {
        moduleId = id;
      },
      output(o) {
        outputs.push(o);
      }
    });

    assert.deepEqual(outputs, [3]);

    fs.writeFileSync(inputDir + '/local.js', 'exports.a = 5; exports.b = 5;');

    await nextEvent(b, 'bundled');
    assert.notEqual(moduleId, undefined);
    assert.deepEqual(outputs, [
      3,
      'dispose-' + moduleId,
      10,
      'accept-' + moduleId
    ]);
  });

  it('should work across bundles', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/hmr-dynamic', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
    let bundle = await b.bundle();
    let outputs = [];

    run(bundle, {
      output(o) {
        outputs.push(o);
      }
    });

    await sleep(50);
    assert.deepEqual(outputs, [3]);

    fs.writeFileSync(inputDir + '/local.js', 'exports.a = 5; exports.b = 5;');

    await nextEvent(b, 'bundled');
    await sleep(50);
    assert.deepEqual(outputs, [3, 10]);
  });

  it('should log emitted errors', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/commonjs', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
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
      inputDir + '/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');
    await sleep(50);

    assert.equal(logs.length, 1);
    assert(logs[0].trim().startsWith('[parcel] 🚨'));
  });

  it('should log when errors resolve', async function() {
    let inputDir = __dirname + `/input/${calculateTestKey(this.test)}`;
    await ncp(__dirname + '/integration/commonjs', inputDir);

    b = bundler(inputDir + '/index.js', this.test, {
      watch: true,
      hmr: true
    });
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
      inputDir + '/local.js',
      'require("fs"; exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');

    fs.writeFileSync(
      inputDir + '/local.js',
      'require("fs"); exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');
    await sleep(50);

    assert.equal(logs.length, 2);
    assert(logs[0].trim().startsWith('[parcel] 🚨'));
    assert(logs[1].trim().startsWith('[parcel] ✨'));
  });
});
