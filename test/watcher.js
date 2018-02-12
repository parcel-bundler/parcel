const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {bundler, run, assertBundleTree, sleep, nextBundle} = require('./utils');
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
        'common.js',
        'common-dep.js',
        'bundle-loader.js',
        'bundle-url.js',
        'js-loader.js'
      ],
      childBundles: [
        {
          assets: ['a.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['b.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          type: 'map'
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
      assets: ['index.js', 'bundle-loader.js', 'bundle-url.js', 'js-loader.js'],
      childBundles: [
        {
          assets: ['a.js', 'common.js', 'common-dep.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['b.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          type: 'map'
        }
      ]
    });

    output = run(bundle);
    assert.equal(await output(), 8);
  });

  it('should only re-package bundles that changed', async function() {
    await ncp(__dirname + '/integration/dynamic-hoist', __dirname + '/input');
    b = bundler(__dirname + '/input/index.js', {watch: true});

    await b.bundle();
    let mtimes = fs
      .readdirSync(__dirname + '/dist')
      .map(
        f => (fs.statSync(__dirname + '/dist/' + f).mtime.getTime() / 1000) | 0
      );

    await sleep(1100); // mtime only has second level precision
    fs.writeFileSync(
      __dirname + '/input/b.js',
      'module.exports = require("./common")'
    );

    await nextBundle(b);
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
        'common.js',
        'common-dep.js',
        'bundle-loader.js',
        'bundle-url.js',
        'js-loader.js'
      ],
      childBundles: [
        {
          assets: ['a.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['b.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          type: 'map'
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
        'common.js',
        'bundle-loader.js',
        'bundle-url.js',
        'js-loader.js'
      ],
      childBundles: [
        {
          assets: ['a.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['b.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          type: 'map'
        }
      ]
    });

    output = run(bundle);
    assert.equal(await output(), 13);

    assert(!b.loadedAssets.has(path.join(__dirname, '/input/common-dep.js')));
  });

  it('should recompile all assets when a config file changes', async function() {
    await ncp(__dirname + '/integration/babel', __dirname + '/input');
    b = bundler(__dirname + '/input/index.js', {watch: true});

    await b.bundle();
    let file = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(file.includes('class Foo {}'));
    assert(file.includes('class Bar {}'));

    // Change babelrc, should recompile both files
    let babelrc = JSON.parse(
      fs.readFileSync(__dirname + '/input/.babelrc', 'utf8')
    );
    babelrc.presets[0][1].targets.browsers.push('IE >= 11');
    fs.writeFileSync(__dirname + '/input/.babelrc', JSON.stringify(babelrc));

    await nextBundle(b);
    file = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(!file.includes('class Foo {}'));
    assert(!file.includes('class Bar {}'));
  });
});
