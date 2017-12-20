const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {bundle, run, assertBundleTree} = require('./utils');

describe('javascript', function() {
  it('should produce a basic JS bundle with CommonJS requires', async function() {
    let b = await bundle(__dirname + '/integration/commonjs/index.js');

    assert.equal(b.assets.size, 8);
    assert.equal(b.childBundles.size, 0);

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should produce a basic JS bundle with ES6 imports', async function() {
    let b = await bundle(__dirname + '/integration/es6/index.js');

    assert.equal(b.assets.size, 8);
    assert.equal(b.childBundles.size, 0);

    let output = run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should produce a JS bundle with default exorts and no imports', async function() {
    let b = await bundle(__dirname + '/integration/es6-default-only/index.js');

    assert.equal(b.assets.size, 1);
    assert.equal(b.childBundles.size, 0);

    let output = run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should split bundles when a dynamic import is used', async function() {
    let b = await bundle(__dirname + '/integration/dynamic/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'bundle-loader.js',
        'bundle-url.js',
        'fetch-browser.js'
      ],
      childBundles: [
        {
          assets: ['local.js'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should dynamic import files which import raw files', async function() {
    let b = await bundle(
      __dirname + '/integration/dynamic-references-raw/index.js'
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'fetch-browser.js',
        'bundle-loader.js',
        'bundle-url.js'
      ],
      childBundles: [
        {
          assets: ['local.js', 'test.txt'],
          childBundles: ['test.txt']
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should return all exports as an object when using ES modules', async function() {
    let b = await bundle(__dirname + '/integration/dynamic-esm/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'fetch-browser.js',
        'bundle-loader.js',
        'bundle-url.js'
      ],
      childBundles: [
        {
          assets: ['local.js'],
          childBundles: []
        }
      ]
    });

    let output = run(b).default;
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should hoist common dependencies into a parent bundle', async function() {
    let b = await bundle(__dirname + '/integration/dynamic-hoist/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'common.js',
        'common-dep.js',
        'bundle-loader.js',
        'bundle-url.js',
        'fetch-browser.js'
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

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should support requiring JSON files', async function() {
    let b = await bundle(__dirname + '/integration/json/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.json'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support importing a URL to a raw asset', async function() {
    let b = await bundle(__dirname + '/integration/import-raw/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: [
        {
          type: 'txt',
          assets: ['test.txt'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert(/^\/[0-9a-f]+\.txt$/.test(output()));
    assert(fs.existsSync(__dirname + '/dist/' + output()));
  });

  it('should minify JS in production mode', async function() {
    let b = await bundle(__dirname + '/integration/uglify/index.js', {
      production: true
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let js = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(!js.includes('local.a'));
  });

  it('should use uglify config', async function() {
    let b = await bundle(__dirname + '/integration/uglify-config/index.js', {
      production: true
    });

    let js = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(js.includes('console.log'));
  });

  it('should insert global variables when needed', async function() {
    let b = await bundle(__dirname + '/integration/globals/index.js');

    let output = run(b);
    assert.deepEqual(output(), {
      dir: path.join(__dirname, '/integration/globals'),
      file: path.join(__dirname, '/integration/globals/index.js'),
      buf: new Buffer('browser').toString('base64'),
      global: true
    });
  });

  it('should insert environment variables', async function() {
    let b = await bundle(__dirname + '/integration/env/index.js');

    let output = run(b);
    assert.equal(output(), 'test:test');
  });

  it('should support adding implicit dependencies', async function() {
    let b = await bundle(__dirname + '/integration/json/index.js', {
      delegate: {
        getImplicitDependencies(asset) {
          if (asset.basename === 'index.js') {
            return [{name: __dirname + '/integration/css/index.css'}];
          }
        }
      }
    });

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.json', 'index.css'],
      childBundles: [
        {
          type: 'css',
          assets: ['index.css']
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring YAML files', async function() {
    let b = await bundle(__dirname + '/integration/yaml/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.yaml'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring CoffeeScript files', async function() {
    let b = await bundle(__dirname + '/integration/coffee/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.coffee'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });
});
