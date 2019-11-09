import assert from 'assert';
import path from 'path';
import {
  bundler,
  run,
  inputFS as fs,
  getNextBuild,
  defaultConfig
} from '@parcel/test-utils';
import getPort from 'get-port';
import JSDom from 'jsdom';
import nullthrows from 'nullthrows';

const inputDir = path.join(__dirname, '/input');

describe('react-refresh', function() {
  let b,
    root,
    window,
    randoms = {};

  before(async () => {
    await fs.ncp(path.join(__dirname, '/integration/react-refresh'), inputDir);
    let port = await getPort();
    b = bundler(path.join(inputDir, 'index.jsx'), {
      outputFS: fs,
      hot: {
        port
      },
      env: {
        HMR_HOSTNAME: '127.0.0.1',
        HMR_PORT: port
      },
      defaultConfig: {
        ...defaultConfig,
        reporters: ['@parcel/reporter-hmr-server']
      }
    });

    window = new JSDom.JSDOM(`<div id="root"></div>`, {
      runScripts: 'outside-only',
      url: 'http://127.0.0.1/index.html'
    }).window;
    window.console.clear = () => {};
    let {document} = window;
    root = document.getElementById('root');

    await b.watch();
  });

  it('bundle executes', async function() {
    let bundleEvent = await getNextBuild(b);
    assert(bundleEvent.type === 'buildSuccess');
    let bundle = nullthrows(
      bundleEvent.bundleGraph.getBundles().find(b => b.type === 'js')
    );
    window.eval(await fs.readFile(nullthrows(bundle.filePath), 'utf8'));
    // ReactDOM.render
    window.parcelRequire(bundle.getMainEntry().id).default();

    let [, indexNum, appNum, fooText, fooNum] = root.textContent.match(
      /^([\d.]+) ([\d.]+) ([\w]+):([\d.]+)$/
    );
    assert(indexNum);
    assert(appNum);
    assert(fooNum);
    assert.equal(fooText, 'Functional');

    randoms = {indexNum, appNum, fooNum};
  });

  it('retains state in functional components', async function() {
    await fs.copyFile(
      path.join(inputDir, 'Foo.1.jsx'),
      path.join(inputDir, 'Foo.jsx')
    );
    assert((await getNextBuild(b)).type === 'buildSuccess');

    // Wait for the hmr-runtime to process the event
    await new Promise(res => setTimeout(res, 100));

    let [, indexNum, appNum, fooText, fooNum] = root.textContent.match(
      /^([\d.]+) ([\d.]+) ([\w]+):([\d.]+)$/
    );
    assert.equal(randoms.indexNum, indexNum);
    assert.equal(randoms.appNum, appNum);
    assert.equal(randoms.fooNum, fooNum);
    assert.equal(fooText, 'OtherFunctional');
  });

  it('supports changing hooks in functional components', async function() {
    await fs.copyFile(
      path.join(inputDir, 'Foo.2-hooks.jsx'),
      path.join(inputDir, 'Foo.jsx')
    );
    assert((await getNextBuild(b)).type === 'buildSuccess');

    // Wait for the hmr-runtime to process the event
    await new Promise(res => setTimeout(res, 100));

    let [, indexNum, appNum, fooText, fooNum, fooNum2] = root.textContent.match(
      /^([\d.]+) ([\d.]+) ([\w]+):([\d.]+):([\d.]+)$/
    );
    assert.equal(randoms.indexNum, indexNum);
    assert.equal(randoms.appNum, appNum);
    assert.notEqual(randoms.fooNum, fooNum);
    assert(fooNum2);
    assert.equal(fooText, 'Hooks');

    randoms.fooNum = fooNum;
  });

  it('retains state in parent components when swapping function and class component', async function() {
    await fs.copyFile(
      path.join(inputDir, 'Foo.3-class.jsx'),
      path.join(inputDir, 'Foo.jsx')
    );
    assert((await getNextBuild(b)).type === 'buildSuccess');

    // Wait for the hmr-runtime to process the event
    await new Promise(res => setTimeout(res, 100));

    let [, indexNum, appNum, fooText, fooNum] = root.textContent.match(
      /^([\d.]+) ([\d.]+) ([\w]+):([\d.]+)$/
    );
    assert.equal(randoms.indexNum, indexNum);
    assert.equal(randoms.appNum, appNum);
    assert.notEqual(randoms.fooNum, fooNum);
    assert.equal(fooText, 'Class');
  });

  after(() => {
    if (window) window.close();
  });
});
