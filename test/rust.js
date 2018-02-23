const assert = require('assert');
const {bundle, bundler, run, assertBundleTree} = require('./utils');
const fs = require('fs');
const commandExists = require('command-exists');

describe('rust', function() {
  if (typeof WebAssembly === 'undefined' || !commandExists.sync('rustup')) {
    // eslint-disable-next-line no-console
    console.log(
      'Skipping Rust tests. Install https://www.rustup.rs/ to run them.'
    );
    return;
  }

  it('should generate a wasm file from a rust file with rustc', async function() {
    this.timeout(500000);
    let b = await bundle(__dirname + '/integration/rust/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'bundle-loader.js',
        'bundle-url.js',
        'index.js',
        'wasm-loader.js'
      ],
      childBundles: [
        {
          type: 'wasm',
          assets: ['add.rs'],
          childBundles: []
        },
        {
          type: 'map'
        }
      ]
    });

    var res = await run(b);
    assert.equal(res, 5);

    // not minified
    assert(fs.statSync(Array.from(b.childBundles)[0].name).size > 500);
  });

  it('should support rust files with dependencies via rustc', async function() {
    this.timeout(500000);
    let b = bundler(__dirname + '/integration/rust-deps/index.js');
    let bundle = await b.bundle();

    assertBundleTree(bundle, {
      name: 'index.js',
      assets: [
        'bundle-loader.js',
        'bundle-url.js',
        'index.js',
        'wasm-loader.js'
      ],
      childBundles: [
        {
          type: 'map'
        },
        {
          type: 'wasm',
          assets: ['test.rs'],
          childBundles: []
        }
      ]
    });

    var res = await run(bundle);
    assert.equal(res, 10);
  });

  it('should generate a wasm file from a rust file with cargo', async function() {
    this.timeout(500000);
    let b = await bundle(__dirname + '/integration/rust-cargo/src/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'bundle-loader.js',
        'bundle-url.js',
        'index.js',
        'wasm-loader.js'
      ],
      childBundles: [
        {
          type: 'map'
        },
        {
          type: 'wasm',
          assets: ['lib.rs'],
          childBundles: []
        }
      ]
    });

    var res = await run(b);
    assert.equal(res, 5);
  });

  it('should use wasm-gc to minify output', async function() {
    this.timeout(500000);

    // Store the size of not minified bundle in order to test it against
    // the size of minified one.
    let b = await bundle(__dirname + '/integration/rust/index.js', {
      minify: false,
      sourceMaps: false
    });
    const size = fs.statSync(Array.from(b.childBundles)[0].name).size;

    let bMinified = await bundle(__dirname + '/integration/rust/index.js', {
      minify: true,
      sourceMaps: false
    });

    const bundleTree = {
      name: 'index.js',
      assets: [
        'bundle-loader.js',
        'bundle-url.js',
        'index.js',
        'wasm-loader.js'
      ],
      childBundles: [
        {
          type: 'wasm',
          assets: ['add.rs'],
          childBundles: []
        }
      ]
    };

    assertBundleTree(b, bundleTree);
    assertBundleTree(bMinified, bundleTree);

    var res = await run(bMinified);
    assert.equal(res, 5);

    const sizeMinified = fs.statSync(Array.from(bMinified.childBundles)[0].name)
      .size;
    assert(sizeMinified < size);
  });
});
