// @flow
import assert from 'assert';
import path from 'path';
import {
  bundler,
  defaultConfig,
  getNextBuild,
  overlayFS,
  outputFS,
  ncp,
} from '@parcel/test-utils';
// import {sleep} from '@parcel/test-utils';
import WebSocket from 'ws';
import json5 from 'json5';
import getPort from 'get-port';

const config = {
  ...defaultConfig,
  reporters: ['@parcel/reporter-hmr-server'],
};

describe.only('hmr', function() {
  let subscription;
  let ws;

  beforeEach(async function() {
    await outputFS.rimraf(path.join(__dirname, '/input'));
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input'),
    );
  });

  afterEach(async () => {
    if (subscription) {
      await subscription.unsubscribe();
    }
    subscription = null;
    await closeSocket(ws);
  });

  async function nextWSMessage(ws: WebSocket) {
    return json5.parse(
      await new Promise(resolve => ws.once('message', resolve)),
    );
  }

  async function closeSocket(ws: WebSocket) {
    ws.close();
    await new Promise(resolve => (ws.onclose = resolve));
  }

  async function openSocket(uri: string) {
    let ws = new WebSocket(uri);

    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    return ws;
  }

  it('should emit an HMR update for the file that changed', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost',
      },
      inputFS: overlayFS,
      config,
    });

    subscription = await b.watch();
    await getNextBuild(b);

    ws = await openSocket('ws://localhost:' + port);

    outputFS.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5;\nexports.b = 5;',
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');

    // Figure out why output doesn't change...
    let localAsset = message.assets.find(
      asset => asset.output === 'exports.a = 5;\nexports.b = 5;',
    );
    assert(!!localAsset);
  });

  it('should emit an HMR update for all new dependencies along with the changed file', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost',
      },
      inputFS: overlayFS,
      config,
    });

    subscription = await b.watch();
    await getNextBuild(b);

    ws = await openSocket('ws://localhost:' + port);

    outputFS.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"); exports.a = 5; exports.b = 5;',
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');

    assert.equal(message.assets.length, 2);
  });

  it('should emit an HMR error on bundle failure', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost',
      },
      inputFS: overlayFS,
      config,
    });

    subscription = await b.watch();
    await getNextBuild(b);

    ws = await openSocket('ws://localhost:' + port);

    outputFS.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;',
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'error');

    assert(!!message.diagnostics, 'Should contain a diagnostics key');
    assert(!!message.diagnostics.html, 'Should contain a html diagnostic');
    assert(!!message.diagnostics.ansi, 'Should contain an ansi diagnostic');
  });

  it('should emit an HMR error to new connections after a bundle failure', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost',
      },
      inputFS: overlayFS,
      config,
    });

    subscription = await b.watch();
    await getNextBuild(b);

    await outputFS.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;',
    );

    ws = await openSocket('ws://localhost:' + port);
    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'error');
  });

  it('should emit an HMR update after error has been resolved', async function() {
    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost',
      },
      inputFS: overlayFS,
      config,
    });

    subscription = await b.watch();
    await getNextBuild(b);

    ws = await openSocket('ws://localhost:' + port);

    await outputFS.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;',
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'error');

    await outputFS.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"); exports.a = 5; exports.b = 5;',
    );

    message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');
  });

  /*it.skip('should work with circular dependencies', async function() {
    await ncp(
      path.join(__dirname, '/integration/hmr-circular'),
      path.join(__dirname, '/input'),
    );

    let b = bundler(path.join(__dirname, '/input/index.js'), {
      watch: true,
      hmr: true,
    });
    let bundle = await b.bundle();
    let outputs = [];

    await run(bundle, {
      output(o) {
        outputs.push(o);
      },
    });

    assert.deepEqual(outputs, [3]);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      "var other = require('./index.js'); exports.a = 5; exports.b = 5;",
    );

    // await nextEvent(b, 'bundled');
    assert.deepEqual(outputs, [3, 10]);
  });

  it.skip('should accept HMR updates in the runtime after an initial error', async function() {
    await fs.mkdirp(path.join(__dirname, '/input'));
    fs.writeFile(
      path.join(__dirname, '/input/index.js'),
      'module.hot.accept();throw new Error("Something");\noutput(123);',
    );

    let b = bundler(path.join(__dirname, '/input/index.js'), {
      watch: true,
      hmr: true,
    });
    let bundle = await b.bundle();

    let outputs = [];
    let errors = [];

    var ctx = prepareBrowserContext(bundle, {
      output(o) {
        outputs.push(o);
      },
      error(e) {
        errors.push(e);
      },
    });
    vm.createContext(ctx);
    vm.runInContext(
      `try {
        ${(await fs.readFile(bundle.name)).toString()}
      } catch(e) {
        error(e);
      }`,
      ctx,
    );

    assert.deepEqual(outputs, []);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'Something');

    await sleep(100);
    fs.writeFile(path.join(__dirname, '/input/index.js'), 'output(123);');

    // await nextEvent(b, 'bundled');
    assert.deepEqual(outputs, [123]);
    assert.equal(errors.length, 1);
  });

  it.skip('should call dispose and accept callbacks', async function() {
    await ncp(
      path.join(__dirname, '/integration/hmr-callbacks'),
      path.join(__dirname, '/input'),
    );

    let port = await getPort();
    let b = await bundle(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost',
      },
      env: {
        HMR_HOSTNAME: 'localhost',
        HMR_PORT: port,
      },
      watch: true,
    });

    let outputs = [];
    let moduleId = '';

    await run(b, {
      reportModuleId(id) {
        moduleId = id;
      },
      output(o) {
        outputs.push(o);
      },
    });

    assert.deepEqual(outputs, [3]);

    let ws = new WebSocket('ws://localhost:' + port);

    await sleep(50);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5; exports.b = 5;',
    );

    await nextWSMessage(ws);
    await sleep(50);

    assert.notEqual(moduleId, undefined);
    assert.deepEqual(outputs, [
      3,
      'dispose-' + moduleId,
      10,
      'accept-' + moduleId,
    ]);
  });

  it.skip('should work across bundles', async function() {
    await ncp(
      path.join(__dirname, '/integration/hmr-dynamic'),
      path.join(__dirname, '/input'),
    );

    let port = await getPort();
    let b = await bundle(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost',
      },
      env: {
        HMR_HOSTNAME: 'localhost',
        HMR_PORT: port,
      },
      watch: true,
    });

    let outputs = [];

    await run(b, {
      output(o) {
        outputs.push(o);
      },
    });

    await sleep(50);
    assert.deepEqual(outputs, [3]);

    let ws = new WebSocket('ws://localhost:' + port);

    await sleep(50);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5; exports.b = 5;',
    );

    await nextWSMessage(ws);
    await sleep(50);

    assert.deepEqual(outputs, [3, 10]);
  });

  it.skip('should bubble up HMR events to a page reload', async function() {
    await ncp(
      path.join(__dirname, '/integration/hmr-reload'),
      path.join(__dirname, '/input'),
    );

    let b = bundler(path.join(__dirname, '/input/index.js'), {
      watch: true,
      hmr: true,
    });
    let bundle = await b.bundle();

    let outputs = [];
    let ctx = await run(
      bundle,
      {
        output(o) {
          outputs.push(o);
        },
      },
      {require: false},
    );
    let spy = sinon.spy(ctx.location, 'reload');

    await sleep(50);
    assert.deepEqual(outputs, [3]);
    assert(spy.notCalled);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5; exports.b = 5;',
    );

    // await nextEvent(b, 'bundled');
    assert.deepEqual(outputs, [3]);
    assert(spy.calledOnce);
  });

  it.skip('should trigger a page reload when a new bundle is created', async function() {
    await ncp(
      path.join(__dirname, '/integration/hmr-new-bundle'),
      path.join(__dirname, '/input'),
    );

    let b = bundler(path.join(__dirname, '/input/index.html'), {
      watch: true,
      hmr: true,
    });
    let bundle = await b.bundle();

    let ctx = await run([...bundle.childBundles][0], {}, {require: false});
    let spy = sinon.spy(ctx.location, 'reload');

    await sleep(50);
    assert(spy.notCalled);

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/index.js'),
      'import "./index.css"',
    );

    // await nextEvent(b, 'bundled');
    assert(spy.calledOnce);

    let contents = await fs.readFile(
      path.join(__dirname, '/dist/index.html'),
      'utf8',
    );
    assert(contents.includes('.css'));
  });

  it.skip('should log emitted errors and show an error overlay', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input'),
    );

    let port = await getPort();
    let b = await bundle(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost',
      },
      env: {
        HMR_HOSTNAME: 'localhost',
        HMR_PORT: port,
      },
      watch: true,
    });

    let logs = [];
    let ctx = await run(
      b,
      {
        console: {
          error(msg) {
            logs.push(msg);
          },
          log() {},
          clear() {},
        },
      },
      {require: false},
    );

    let spy = sinon.spy(ctx.document.body, 'appendChild');
    let ws = new WebSocket('ws://localhost:' + port);

    await sleep(50);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;',
    );

    await nextWSMessage(ws);
    await sleep(50);

    assert.equal(logs.length, 1);
    assert(logs[0].trim().startsWith('[parcel] 🚨'));
    assert(spy.calledOnce);
  });

  it.skip('should log when errors resolve', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input'),
    );

    let port = await getPort();
    let b = await bundle(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: false,
        port,
        host: 'localhost',
      },
      env: {
        HMR_HOSTNAME: 'localhost',
        HMR_PORT: port,
      },
      watch: true,
    });

    let logs = [];
    let ctx = await run(
      b,
      {
        console: {
          error(msg) {
            logs.push(msg);
          },
          log(msg) {
            logs.push(msg);
          },
          clear() {},
        },
        location: {hostname: 'localhost', reload: function() {}},
      },
      {require: false},
    );

    let appendSpy = sinon.spy(ctx.document.body, 'appendChild');
    let removeSpy = sinon.spy(ctx.document.getElementById('tmp'), 'remove');
    let ws = new WebSocket('ws://localhost:' + port);

    await sleep(50);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"; exports.a = 5; exports.b = 5;',
    );

    await nextWSMessage(ws);
    await sleep(50);

    assert(appendSpy.called);

    await sleep(50);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'require("fs"); exports.a = 5; exports.b = 5;',
    );
    await nextWSMessage(ws);
    await sleep(50);

    assert(removeSpy.called);

    // assert.equal(logs.length, 2);
    assert(logs[0].trim().startsWith('[parcel] 🚨'));
    assert(logs[1].trim().startsWith('[parcel] ✨'));
  });

  it.skip('should make a secure connection', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input'),
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: true,
        port,
        host: 'localhost',
      },
      watch: true,
    });

    await b.run();

    let ws = new WebSocket('wss://localhost:' + port, {
      rejectUnauthorized: false,
    });

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5;\nexports.b = 5;',
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');

    assert.equal(message.assets.length, 1);
    assert.equal(message.assets[0].generated.js, 'exports.a = 5;\nexports.b = 5;');
    assert.deepEqual(message.assets[0].deps, {});

    await closeSocket(ws);
  });

  it.skip('should make a secure connection with custom certificate', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs'),
      path.join(__dirname, '/input'),
    );

    let port = await getPort();
    let b = bundler(path.join(__dirname, '/input/index.js'), {
      hot: {
        https: {
          key: path.join(__dirname, '/integration/https/private.pem'),
          cert: path.join(__dirname, '/integration/https/primary.crt'),
        },
        port,
        host: 'localhost',
      },
      watch: true,
    });

    await b.run();

    let ws = new WebSocket('wss://localhost:' + port, {
      rejectUnauthorized: false,
    });

    await sleep(100);
    fs.writeFile(
      path.join(__dirname, '/input/local.js'),
      'exports.a = 5;\nexports.b = 5;',
    );

    let message = await nextWSMessage(ws);

    assert.equal(message.type, 'update');

    assert.equal(message.assets.length, 1);
    assert.equal(message.assets[0].generated.js, 'exports.a = 5;\nexports.b = 5;');
    assert.deepEqual(message.assets[0].deps, {});

    await closeSocket(ws);
  });*/
});
