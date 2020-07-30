import assert from 'assert';
import path from 'path';
import {
  bundler,
  defaultConfig,
  getNextBuild,
  overlayFS as fs,
  sleep,
} from '@parcel/test-utils';
import getPort from 'get-port';
import JSDOM from 'jsdom';
import nullthrows from 'nullthrows';

let MessageChannel;
try {
  ({MessageChannel} = require('worker_threads'));
} catch (_) {
  // eslint-disable-next-line no-console
  console.log(
    'Skipping React Fast Refresh tests because they require worker_threads',
  );
}

if (MessageChannel) {
  describe('react-refresh', function() {
    describe('synchronous', () => {
      const testDir = path.join(__dirname, '/integration/react-refresh');

      let b,
        root,
        window,
        subscription,
        randoms = {};

      beforeEach(async () => {
        ({b, root, window, subscription, randoms} = await setup(
          path.join(testDir, 'index.html'),
        ));
      });

      it('retains state in functional components', async function() {
        await fs.mkdirp(testDir);
        await fs.copyFile(
          path.join(testDir, 'Foo.1.js'),
          path.join(testDir, 'Foo.js'),
        );
        assert.equal((await getNextBuild(b)).type, 'buildSuccess');

        // Wait for the hmr-runtime to process the event
        await sleep(100);

        let [, indexNum, appNum, fooText, fooNum] = root.textContent.match(
          /^([\d.]+) ([\d.]+) ([\w]+):([\d.]+)$/,
        );
        assert.equal(randoms.indexNum, indexNum);
        assert.equal(randoms.appNum, appNum);
        assert.equal(randoms.fooNum, fooNum);
        assert.equal(fooText, 'OtherFunctional');
      });

      it('supports changing hooks in functional components', async function() {
        await fs.mkdirp(testDir);
        await fs.copyFile(
          path.join(testDir, 'Foo.2-hooks.js'),
          path.join(testDir, 'Foo.js'),
        );
        assert.equal((await getNextBuild(b)).type, 'buildSuccess');

        // Wait for the hmr-runtime to process the event
        await sleep(100);

        let [
          ,
          indexNum,
          appNum,
          fooText,
          fooNum,
          fooNum2,
        ] = root.textContent.match(
          /^([\d.]+) ([\d.]+) ([\w]+):([\d.]+):([\d.]+)$/,
        );
        assert.equal(randoms.indexNum, indexNum);
        assert.equal(randoms.appNum, appNum);
        assert.notEqual(randoms.fooNum, fooNum);
        assert(fooNum2);
        assert.equal(fooText, 'Hooks');
      });

      it('retains state in parent components when swapping function and class component', async function() {
        await fs.mkdirp(testDir);
        await fs.copyFile(
          path.join(testDir, 'Foo.3-class.js'),
          path.join(testDir, 'Foo.js'),
        );
        assert.equal((await getNextBuild(b)).type, 'buildSuccess');

        // Wait for the hmr-runtime to process the event
        await sleep(100);

        let [, indexNum, appNum, fooText, fooNum] = root.textContent.match(
          /^([\d.]+) ([\d.]+) ([\w]+):([\d.]+)$/,
        );
        assert.equal(randoms.indexNum, indexNum);
        assert.equal(randoms.appNum, appNum);
        assert.notEqual(randoms.fooNum, fooNum);
        assert.equal(fooText, 'Class');
      });

      afterEach(async () => {
        await cleanup({subscription, window});
      });
    });

    describe('lazy child component', () => {
      const testDir = path.join(
        __dirname,
        '/integration/react-refresh-lazy-child',
      );

      let b,
        root,
        window,
        subscription,
        randoms = {};

      beforeEach(async () => {
        ({b, root, window, subscription, randoms} = await setup(
          path.join(testDir, 'index.html'),
        ));
      });

      it('retains state in async components on change', async function() {
        assert.equal(randoms.fooText, 'Async');

        await fs.mkdirp(testDir);
        await fs.copyFile(
          path.join(testDir, 'Async.1.js'),
          path.join(testDir, 'Async.js'),
        );
        assert.equal((await getNextBuild(b)).type, 'buildSuccess');

        // Wait for the hmr-runtime to process the event
        await sleep(100);

        let [, indexNum, appNum, fooText, fooNum] = root.textContent.match(
          /^([\d.]+) ([\d.]+) ([\w]+):([\d.]+)$/,
        );
        assert.equal(randoms.indexNum, indexNum);
        assert.equal(randoms.appNum, appNum);
        assert.equal(randoms.fooNum, fooNum);
        assert.equal(fooText, 'OtherAsync');
      });

      afterEach(async () => {
        await cleanup({subscription, window});
      });
    });
  });
}

async function setup(entry) {
  let port = await getPort(),
    b,
    window,
    randoms,
    subscription,
    root;

  b = bundler(entry, {
    inputFS: fs,
    outputFS: fs,
    serve: {
      https: false,
      port,
      host: '127.0.0.1',
    },
    hot: {
      port,
    },
    defaultConfig: {
      ...defaultConfig,
      reporters: ['@parcel/reporter-dev-server'],
    },
  });

  subscription = await b.watch();
  let bundleEvent = await getNextBuild(b);
  assert.equal(bundleEvent.type, 'buildSuccess');

  let dom = await JSDOM.JSDOM.fromURL(
    'http://127.0.0.1:' + port + '/index.html',
    {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
    },
  );
  window = dom.window;
  await new Promise(res =>
    window.document.addEventListener('load', () => {
      res();
    }),
  );
  window.console.clear = () => {};
  window.MessageChannel = MessageChannel;
  root = window.document.getElementById('root');

  let bundle = nullthrows(
    bundleEvent.bundleGraph.getBundles().find(b => b.type === 'js'),
  );
  // ReactDOM.render
  await window
    .parcelRequire(bundle.getEntryAssets().pop().contentHash)
    .default();
  await sleep(100);

  let [, indexNum, appNum, fooText, fooNum] = root.textContent.match(
    /^([\d.]+) ([\d.]+) ([\w]+):([\d.]+)$/,
  );
  assert(indexNum);
  assert(appNum);
  assert(fooNum);

  randoms = {indexNum, appNum, fooText, fooNum};

  return {port, b, window, randoms, subscription, root};
}

async function cleanup({window, subscription}) {
  if (window) {
    window.close();
  }
  if (subscription) {
    await subscription.unsubscribe();
  }
}
