const assert = require('assert');
const fs = require('../src/utils/fs');
const nodeFS = require('fs');
const path = require('path');
const {
  bundler,
  run,
  assertBundleTree,
  sleep,
  nextBundle,
  rimraf,
  ncp
} = require('./utils');
const {symlinkSync} = require('fs');

const inputDir = path.join(__dirname, '/input');

describe('watcher', function() {
  let b;
  beforeEach(async function() {
    await sleep(100);
    await rimraf(inputDir);
    await sleep(100);
  });

  afterEach(async function() {
    if (b) {
      await b.stop();
    }
  });

  it('should rebuild on file change', async function() {
    await ncp(path.join(__dirname, '/integration/commonjs'), inputDir);

    b = bundler(path.join(inputDir, '/index.js'), {watch: true});
    let bundle = await b.bundle();
    let output = await run(bundle);
    assert.equal(output(), 3);

    await sleep(100);
    fs.writeFile(
      path.join(inputDir, '/local.js'),
      'exports.a = 5; exports.b = 5;'
    );

    bundle = await nextBundle(b);
    output = await run(bundle);
    assert.equal(output(), 10);
  });

  it('should re-generate bundle tree when files change', async function() {
    await ncp(path.join(__dirname, '/integration/dynamic-hoist'), inputDir);

    b = bundler(path.join(inputDir, '/index.js'), {watch: true});
    let bundle = await b.bundle();

    await assertBundleTree(bundle, {
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

    let output = await run(bundle);
    assert.equal(await output(), 7);

    // change b.js so that it no longer depends on common.js.
    // This should cause common.js and dependencies to no longer be hoisted to the root bundle.
    await sleep(100);
    fs.writeFile(path.join(inputDir, '/b.js'), 'module.exports = 5;');

    bundle = await nextBundle(b);
    await assertBundleTree(bundle, {
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

    output = await run(bundle);
    assert.equal(await output(), 8);
  });

  it('should only re-package bundles that changed', async function() {
    await ncp(path.join(__dirname, '/integration/dynamic-hoist'), inputDir);
    b = bundler(path.join(inputDir, '/index.js'), {watch: true});

    await b.bundle();
    let mtimes = (await fs.readdir(path.join(__dirname, '/dist'))).map(
      f =>
        (nodeFS.statSync(path.join(__dirname, '/dist/', f)).mtime.getTime() /
          1000) |
        0
    );

    await sleep(1100); // mtime only has second level precision
    fs.writeFile(
      path.join(inputDir, '/b.js'),
      'module.exports = require("./common")'
    );

    await nextBundle(b);
    let newMtimes = (await fs.readdir(path.join(__dirname, '/dist'))).map(
      f =>
        (nodeFS.statSync(path.join(__dirname, '/dist/', f)).mtime.getTime() /
          1000) |
        0
    );
    assert.deepEqual(mtimes.sort().slice(0, 2), newMtimes.sort().slice(0, 2));
    assert.notEqual(mtimes[mtimes.length - 1], newMtimes[newMtimes.length - 1]);
  });

  it('should unload assets that are orphaned', async function() {
    await ncp(path.join(__dirname, '/integration/dynamic-hoist'), inputDir);
    b = bundler(path.join(inputDir, '/index.js'), {watch: true});

    let bundle = await b.bundle();
    await assertBundleTree(bundle, {
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

    let output = await run(bundle);
    assert.equal(await output(), 7);

    assert(b.loadedAssets.has(path.join(inputDir, '/common-dep.js')));

    // Get rid of common-dep.js
    await sleep(100);
    fs.writeFile(path.join(inputDir, '/common.js'), 'module.exports = 5;');

    bundle = await nextBundle(b);
    await assertBundleTree(bundle, {
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

    output = await run(bundle);
    assert.equal(await output(), 13);

    assert(!b.loadedAssets.has(path.join(inputDir, 'common-dep.js')));
  });

  it('should recompile all assets when a config file changes', async function() {
    await ncp(path.join(__dirname, '/integration/babel'), inputDir);
    b = bundler(path.join(inputDir, 'index.js'), {watch: true});

    await b.bundle();
    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(!file.includes('function Foo'));
    assert(!file.includes('function Bar'));

    // Change babelrc, should recompile both files
    let babelrc = JSON.parse(
      await fs.readFile(path.join(inputDir, '/.babelrc'), 'utf8')
    );
    babelrc.presets[0][1].targets.browsers.push('IE >= 11');

    await sleep(100);
    fs.writeFile(path.join(inputDir, '/.babelrc'), JSON.stringify(babelrc));

    await nextBundle(b);
    file = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should rebuild if the file behind a symlink changes', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs-with-symlinks/'),
      inputDir
    );

    // Create the symlink here to prevent cross platform and git issues
    symlinkSync(
      path.join(inputDir, 'local.js'),
      path.join(inputDir, 'src/symlinked_local.js')
    );

    b = bundler(path.join(inputDir, '/src/index.js'), {
      watch: true
    });

    let bundle = await b.bundle();
    let output = await run(bundle);

    assert.equal(output(), 3);

    await sleep(100);
    fs.writeFile(
      path.join(inputDir, '/local.js'),
      'exports.a = 5; exports.b = 5;'
    );

    bundle = await nextBundle(b);
    output = await run(bundle);
    assert.equal(output(), 10);
  });
});
