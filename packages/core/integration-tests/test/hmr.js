const assert = require('assert');
const fs = require('@parcel/fs');
const path = require('path');
const {bundler, rimraf, ncp} = require('./utils');
const {sleep} = require('@parcel/test-utils');
const WebSocket = require('ws');
const json5 = require('json5');
const sinon = require('sinon');
const getPort = require('get-port');

describe.only('hmr', function() {
  let stub;
  beforeEach(async function() {
    stub = sinon.stub(console, 'clear');
    await rimraf(path.join(__dirname, '/input'));
  });

  afterEach(async function() {
    stub.restore();
  });

  async function nextWSMessage(ws) {
    return json5.parse(
      await new Promise(resolve => ws.once('message', resolve))
    );
  }

  async function closeSocket(ws) {
    ws.close();
    await new Promise(resolve => (ws.onclose = resolve));
  }

  it('should emit an HMR update for the file that changed', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    let ws = new WebSocket('ws://localhost:' + port);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5;\nexports.b = 5;'
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');

    // Figure out why output doesn't change...
    // let localAsset = message.assets.find(asset => asset.output === 'exports.a = 5;\nexports.b = 5;');
    // assert(!!localAsset);

    // TODO: Get real diffs from assetgraph
    // assert.equal(message.assets.length, 2);

    await closeSocket(ws);
    await sleep(1000);
  });

  it('should emit an HMR update for all new dependencies along with the changed file', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    let ws = new WebSocket('ws://localhost:' + port);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"); exports.a = 5; exports.b = 5;'
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');

    // assert.equal(message.assets.length, 2);

    await closeSocket(ws);
    await sleep(1000);
  });

  it('should emit an HMR error on bundle failure', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    let ws = new WebSocket('ws://localhost:' + port);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;'
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'error');

    // TODO: Figure out how to let HMRReporter use the proper errors
    /*assert.equal(
      message.error.message,
      `${path.join(
        __dirname,
        '/input/local.js'
      )}:1:12: Unexpected token, expected "," (1:12)`
    );

    assert.equal(
      message.error.stack,
      '> 1 | require("fs"; exports.a = 5; exports.b = 5;\n    |            ^'
    );*/

    await closeSocket(ws);
    await sleep(1000);
  });

  it('should emit an HMR error to new connections after a bundle failure', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();
    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;'
    );

    let ws = new WebSocket('ws://localhost:' + port);
    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'error');

    await closeSocket(ws);
    await sleep(1000);
  });

  it('should emit an HMR update after error has been resolved', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    let ws = new WebSocket('ws://localhost:' + port);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;'
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'error');

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"); exports.a = 5; exports.b = 5;'
    );

    message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');

    await closeSocket(ws);
    await sleep(1000);
  });

  it.skip('should accept HMR updates in the runtime', async function() {
    await ncp(
      path.join(__dirname, '/integration/hmr'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    // TODO: Update this test
    /*let outputs = [];

    await run(bundle, {
      output(o) {
        outputs.push(o);
      }
    });

    assert.deepEqual(outputs, [3]);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5; exports.b = 5;'
    );

    await nextEvent(b, 'bundled');
    assert.deepEqual(outputs, [3, 10]);*/
  });

  it.skip('should call dispose and accept callbacks', async function() {
    await ncp(
      path.join(__dirname, '/integration/hmr-callbacks'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    // TODO: Update this test
    /*let outputs = [];
    let moduleId = '';

    await run(bundle, {
      reportModuleId(id) {
        moduleId = id;
      },
      output(o) {
        outputs.push(o);
      }
    });

    assert.deepEqual(outputs, [3]);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5; exports.b = 5;'
    );

    await nextEvent(b, 'bundled');
    assert.notEqual(moduleId, undefined);
    assert.deepEqual(outputs, [
      3,
      'dispose-' + moduleId,
      10,
      'accept-' + moduleId
    ]);*/
  });

  it.skip('should work across bundles', async function() {
    await ncp(
      path.join(__dirname, '/integration/hmr-dynamic'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    // TODO: Update this test
    /*let outputs = [];

    await run(bundle, {
      output(o) {
        outputs.push(o);
      }
    });

    await sleep(50);
    assert.deepEqual(outputs, [3]);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5; exports.b = 5;'
    );

    await nextEvent(b, 'bundled');
    await sleep(50);
    assert.deepEqual(outputs, [3, 10]);*/
  });

  it.skip('should log emitted errors and show an error overlay', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    // TODO: Update this test
    /*let logs = [];
    let ctx = await run(
      bundle,
      {
        console: {
          error(msg) {
            logs.push(msg);
          },
          clear() {}
        }
      },
      {require: false}
    );

    let spy = sinon.spy(ctx.document.body, 'appendChild');

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');
    await sleep(50);

    assert.equal(logs.length, 1);
    assert(logs[0].trim().startsWith('[parcel] 🚨'));
    assert(spy.calledOnce);*/
  });

  it.skip('should log when errors resolve', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    // TODO: Update this test
    /*let logs = [];
    let ctx = await run(
      bundle,
      {
        console: {
          error(msg) {
            logs.push(msg);
          },
          log(msg) {
            logs.push(msg);
          },
          clear() {}
        }
      },
      {require: false}
    );

    let appendSpy = sinon.spy(ctx.document.body, 'appendChild');
    let removeSpy = sinon.spy(ctx.document.getElementById('tmp'), 'remove');

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');
    await sleep(50);

    assert(appendSpy.called);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"); exports.a = 5; exports.b = 5;'
    );
    await nextEvent(b, 'buildEnd');
    await sleep(50);

    assert(removeSpy.called);

    assert.equal(logs.length, 2);
    assert(logs[0].trim().startsWith('[parcel] 🚨'));
    assert(logs[1].trim().startsWith('[parcel] ✨'));*/
  });

  it('should make a secure connection', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: true,
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    let ws = new WebSocket('wss://localhost:' + port, {
      rejectUnauthorized: false
    });

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5;\nexports.b = 5;'
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');

    // TODO: Update this...
    /*assert.equal(message.assets.length, 1);
    assert.equal(message.assets[0].generated.js, 'exports.a = 5;\nexports.b = 5;');
    assert.deepEqual(message.assets[0].deps, {});*/

    await closeSocket(ws);
    await sleep(1000);
  });

  it('should make a secure connection with custom certificate', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input')
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: {
          key: path.join(__dirname, '/integration/https/private.pem'),
          cert: path.join(__dirname, '/integration/https/primary.crt')
        },
        port,
        host: 'localhost'
      },
      watch: true
    });

    await b.run();

    let ws = new WebSocket('wss://localhost:' + port, {
      rejectUnauthorized: false
    });

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5;\nexports.b = 5;'
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');

    // TODO: Update this...
    /*assert.equal(message.assets.length, 1);
    assert.equal(message.assets[0].generated.js, 'exports.a = 5;\nexports.b = 5;');
    assert.deepEqual(message.assets[0].deps, {});*/

    await closeSocket(ws);
    await sleep(1000);
  });
});
