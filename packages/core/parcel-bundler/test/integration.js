const Bundler = require('../');
const rimraf = require('rimraf');
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

describe('integration', function () {
  beforeEach(function () {
    rimraf.sync(__dirname + '/dist');
  });

  function bundle(file) {
    let bundler = new Bundler(file, {outDir: __dirname + '/dist', production: true});
    return bundler.bundle();
  }

  function run(bundle) {
    // for testing dynamic imports
    const fakeDocument = {
      createElement(tag) {
        return {tag};
      },

      getElementsByTagName() {
        return [{
          appendChild(el) {
            if (el.tag === 'script') {
              vm.runInContext(fs.readFileSync(__dirname + '/dist' + el.src), ctx);
            }

            el.onload();
          }
        }]
      }
    };

    var ctx = {
      document: fakeDocument
    };

    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(bundle.name), ctx);
    return ctx.require(bundle.entryAsset.id);
  }

  function assertBundleTree(bundle, tree) {
    if (tree.name) {
      assert.equal(path.basename(bundle.name), tree.name);
    }

    if (tree.type) {
      assert.equal(bundle.type, tree.type);
    }

    if (tree.assets) {
      assert.deepEqual(Array.from(bundle.assets).map(a => a.basename).sort(), tree.assets.sort());
    }

    if (tree.childBundles) {
      let children = Array.from(bundle.childBundles);//.sort((a, b) => a.name - b.name);
      assert.equal(bundle.childBundles.size, tree.childBundles.length);
      tree.childBundles.forEach((b, i) => assertBundleTree(children[i], b));
    }

    assert(fs.existsSync(bundle.name));
  }

  it('should produce a basic JS bundle with CommonJS requires', async function () {
    let b = await bundle(__dirname + '/integration/commonjs/index.js');

    assert.equal(b.assets.size, 8);
    assert.equal(b.childBundles.size, 0);

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should produce a basic JS bundle with ES6 imports', async function () {
    let b = await bundle(__dirname + '/integration/es6/index.js');

    assert.equal(b.assets.size, 8);
    assert.equal(b.childBundles.size, 0);

    let output = run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should produce two bundles when importing a CSS file', async function () {
    let b = await bundle(__dirname + '/integration/css/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css', 'local.js', 'local.css'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.css', 'local.css'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should split bundles when a dynamic import is used', async function () {
    let b = await bundle(__dirname + '/integration/dynamic/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'loader.js'],
      childBundles: [{
        assets: ['local.js'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should support loading a CSS bundle along side dynamic imports', async function () {
    let b = await bundle(__dirname + '/integration/dynamic-css/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css', 'loader.js'],
      childBundles: [{
        type: 'js',
        assets: ['local.js', 'local.css'],
        childBundles: [{
          type: 'css',
          assets: ['local.css'],
          childBundles: []
        }]
      }, {
        name: 'index.css',
        assets: ['index.css'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should hoist common dependencies into a parent bundle', async function () {
    let b = await bundle(__dirname + '/integration/dynamic-hoist/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'common.js', 'common-dep.js', 'loader.js'],
      childBundles: [{
        assets: ['a.js'],
        childBundles: []
      }, {
        assets: ['b.js'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should require a glob of files', async function () {
    let b = await bundle(__dirname + '/integration/glob/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', '*.js', 'a.js', 'b.js'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should require nested directories with a glob', async function () {
    let b = await bundle(__dirname + '/integration/glob-deep/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', '*.js', 'a.js', 'b.js', 'c.js', 'z.js'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 13);
  });
});
