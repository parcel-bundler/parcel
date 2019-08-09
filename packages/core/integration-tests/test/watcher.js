const assert = require('assert');
const nodeFS = require('fs');
const path = require('path');
const {
  bundler,
  getNextBuild,
  run,
  assertBundleTree,
  nextBundle,
  ncp,
  inputFS: fs,
  sleep,
  symlinkPrivilegeWarning
} = require('@parcel/test-utils');
const {symlinkSync} = require('fs');

const inputDir = path.join(__dirname, '/input');
const distDir = path.join(inputDir, 'dist');
//const distDir = path.join(__dirname, '../dist');

describe('watcher', function() {
  let subscription;
  beforeEach(async function() {
    await sleep(100);
    await fs.rimraf(inputDir);
    await sleep(100);
  });

  afterEach(async () => {
    if (subscription) {
      await subscription.unsubscribe();
    }
    subscription = null;
  });

  it.skip('should rebuild on source file change', async function() {
    await ncp(path.join(__dirname, '/integration/commonjs'), inputDir);

    let b = bundler(path.join(inputDir, '/index.js'), {watch: true});
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

  it('should rebuild on a config file change', async function() {
    await ncp(path.join(__dirname, 'integration/custom-config'), inputDir);
    let copyPath = path.join(inputDir, 'configCopy');
    let configPath = path.join(inputDir, '.parcelrc');

    let b = bundler(path.join(inputDir, 'index.js'), {
      outputFS: fs,
      targets: {
        main: {
          engines: {
            node: '^4.0.0'
          },
          distDir
        }
      }
    });

    subscription = await b.watch();
    await getNextBuild(b);
    let distFile = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!distFile.includes('() => null'));
    await fs.copyFile(copyPath, configPath);
    await getNextBuild(b);
    distFile = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(distFile.includes('() => null'));
  });

  it.skip('should re-generate bundle tree when files change', async function() {
    await ncp(path.join(__dirname, '/integration/dynamic-hoist'), inputDir);

    let b = bundler(path.join(inputDir, '/index.js'), {watch: true});
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

  it.skip('should only re-package bundles that changed', async function() {
    await ncp(path.join(__dirname, '/integration/dynamic-hoist'), inputDir);
    let b = bundler(path.join(inputDir, '/index.js'), {watch: true});

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

  it.skip('should unload assets that are orphaned', async function() {
    await ncp(path.join(__dirname, '/integration/dynamic-hoist'), inputDir);
    let b = bundler(path.join(inputDir, '/index.js'), {watch: true});

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

  it.skip('should recompile all assets when a config file changes', async function() {
    await ncp(path.join(__dirname, '/integration/babel'), inputDir);
    let b = bundler(path.join(inputDir, 'index.js'), {watch: true});

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

  it.skip('should rebuild if the file behind a symlink changes', async function() {
    await ncp(
      path.join(__dirname, '/integration/commonjs-with-symlinks/'),
      inputDir
    );

    try {
      // Create the symlink here to prevent cross platform and git issues
      symlinkSync(
        path.join(inputDir, 'local.js'),
        path.join(inputDir, 'src/symlinked_local.js')
      );

      let b = bundler(path.join(inputDir, '/src/index.js'), {
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
    } catch (e) {
      if (e.code == 'EPERM') {
        symlinkPrivilegeWarning();
        this.skip();
      }
    }
  });
});
