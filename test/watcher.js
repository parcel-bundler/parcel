const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {bundler, run, assertBundleTree, sleep} = require('./utils');
const rimraf = require('rimraf');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));

describe('watcher', function() {
  let b;
  beforeEach(function() {
    rimraf.sync(__dirname + '/input');
  });

  afterEach(function() {
    if (b) {
      b.stop();
    }
  });

  function nextBundle(b) {
    return new Promise(resolve => {
      b.once('bundled', resolve);
    });
  }

  it('should rebuild on file change', async function() {
    await ncp(__dirname + '/integration/commonjs', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true});
    let bundle = await b.bundle();
    let output = run(bundle);
    assert.equal(output(), 3);

    fs.writeFileSync(
      __dirname + '/input/local.js',
      'exports.a = 5; exports.b = 5;'
    );

    bundle = await nextBundle(b);
    output = run(bundle);
    assert.equal(output(), 10);
  });

  it('should re-generate bundle tree when files change', async function() {
    await ncp(__dirname + '/integration/dynamic-hoist', __dirname + '/input');

    b = bundler(__dirname + '/input/index.js', {watch: true});
    let bundle = await b.bundle();

    assertBundleTree(bundle, {
      name: 'index.js',
      assets: [
        'index.js',
        'fetch-browser.js',
        'common.js',
        'common-dep.js',
        'bundle-loader.js',
        'bundle-url.js'
      ],
      childBundles: [
        {
          assets: ['a.js'],
          childBundles: []
        },
        {
          assets: ['b.js'],
          childBundles: []
        }
      ]
    });

    let output = run(bundle);
    assert.equal(await output(), 7);

    // change b.js so that it no longer depends on common.js.
    // This should cause common.js and dependencies to no longer be hoisted to the root bundle.
    fs.writeFileSync(__dirname + '/input/b.js', 'module.exports = 5;');

    bundle = await nextBundle(b);
    assertBundleTree(bundle, {
      name: 'index.js',
      assets: [
        'index.js',
        'fetch-browser.js',
        'bundle-loader.js',
        'bundle-url.js'
      ],
      childBundles: [
        {
          assets: ['a.js', 'common.js', 'common-dep.js'],
          childBundles: []
        },
        {
          assets: ['b.js'],
          childBundles: []
        }
      ]
    });

    output = run(bundle);
    assert.equal(await output(), 8);
  });

  it('should only re-package bundles that changed', async function() {
    await ncp(__dirname + '/integration/dynamic-hoist', __dirname + '/input');
    b = bundler(__dirname + '/input/index.js', {watch: true});

    let bundle = await b.bundle();
    let mtimes = fs
      .readdirSync(__dirname + '/dist')
      .map(
        f => (fs.statSync(__dirname + '/dist/' + f).mtime.getTime() / 1000) | 0
      );

    await sleep(1000); // mtime only has second level precision
    fs.writeFileSync(
      __dirname + '/input/b.js',
      'module.exports = require("./common")'
    );

    bundle = await nextBundle(b);
    let newMtimes = fs
      .readdirSync(__dirname + '/dist')
      .map(
        f => (fs.statSync(__dirname + '/dist/' + f).mtime.getTime() / 1000) | 0
      );
    assert.deepEqual(mtimes.sort().slice(0, 2), newMtimes.sort().slice(0, 2));
    assert.notEqual(mtimes[mtimes.length - 1], newMtimes[newMtimes.length - 1]);
  });

  it('should unload assets that are orphaned', async function() {
    await ncp(__dirname + '/integration/dynamic-hoist', __dirname + '/input');
    b = bundler(__dirname + '/input/index.js', {watch: true});

    let bundle = await b.bundle();
    assertBundleTree(bundle, {
      name: 'index.js',
      assets: [
        'index.js',
        'fetch-browser.js',
        'common.js',
        'common-dep.js',
        'bundle-loader.js',
        'bundle-url.js'
      ],
      childBundles: [
        {
          assets: ['a.js'],
          childBundles: []
        },
        {
          assets: ['b.js'],
          childBundles: []
        }
      ]
    });

    let output = run(bundle);
    assert.equal(await output(), 7);

    assert(b.loadedAssets.has(path.join(__dirname, '/input/common-dep.js')));

    // Get rid of common-dep.js
    fs.writeFileSync(__dirname + '/input/common.js', 'module.exports = 5;');

    bundle = await nextBundle(b);
    assertBundleTree(bundle, {
      name: 'index.js',
      assets: [
        'index.js',
        'fetch-browser.js',
        'common.js',
        'bundle-loader.js',
        'bundle-url.js'
      ],
      childBundles: [
        {
          assets: ['a.js'],
          childBundles: []
        },
        {
          assets: ['b.js'],
          childBundles: []
        }
      ]
    });

    output = run(bundle);
    assert.equal(await output(), 13);

    assert(!b.loadedAssets.has(path.join(__dirname, '/input/common-dep.js')));
  });
});
