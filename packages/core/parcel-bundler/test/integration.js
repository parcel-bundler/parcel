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

  function bundle(file, opts) {
    let bundler = new Bundler(file, Object.assign({
      outDir: __dirname + '/dist',
      watch: false,
      enableCache: false,
      killWorkers: false
    }, opts));

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

    if (/js|css/.test(bundle.type)) {
      assert(fs.existsSync(bundle.name));
    }
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
      assets: ['index.js', 'bundle-loader.js'],
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
      assets: ['index.js', 'index.css', 'bundle-loader.js'],
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
      assets: ['index.js', 'common.js', 'common-dep.js', 'bundle-loader.js'],
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

  it('should support requiring JSON files', async function () {
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

  it('should support requiring stylus files', async function () {
    let b = await bundle(__dirname + '/integration/stylus/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.styl'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.styl'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
  });

  it('should support requiring stylus files with dependencies', async function () {
    let b = await bundle(__dirname + '/integration/stylus-deps/index.js');

    // a.styl shouldn't be included as a dependency that we can see.
    // stylus takes care of inlining it.
    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.styl'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.styl'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
    assert(css.includes('.a'));
  });

  it('should support importing CSS from a CSS file', async function () {
    let b = await bundle(__dirname + '/integration/css-import/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.css', 'other.css', 'local.css'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.local'));
    assert(css.includes('.other'));
    assert(/@media print {\s*.other/.test(css));
    assert(css.includes('.index'));
  });

  it('should support linking to assets with url() from CSS', async function () {
    let b = await bundle(__dirname + '/integration/css-url/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.css'],
        childBundles: [{
          type: 'woff2',
          assets: ['test.woff2'],
          childBundles: []
        }]
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(/url\("[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));

    assert(fs.existsSync(__dirname + '/dist/' + css.match(/url\("([0-9a-f]+\.woff2)"\)/)[1]));
  });

  it('should support linking to assets with url() from stylus', async function () {
    let b = await bundle(__dirname + '/integration/stylus-url/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.styl'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.styl'],
        childBundles: [{
          type: 'woff2',
          assets: ['test.woff2'],
          childBundles: []
        }]
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(/url\("[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));

    assert(fs.existsSync(__dirname + '/dist/' + css.match(/url\("([0-9a-f]+\.woff2)"\)/)[1]));
  });

  it('should support transforming with postcss', async function () {
    let b = await bundle(__dirname + '/integration/postcss/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.css'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), '_index_1ezyc_1');

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('._index_1ezyc_1'));
  });

  it('should support transforming stylus with postcss', async function () {
    let b = await bundle(__dirname + '/integration/stylus-postcss/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.styl'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.styl'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), '_index_g9mqo_1');

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('._index_g9mqo_1'));
  });

  it('should support requiring less files', async function () {
    let b = await bundle(__dirname + '/integration/less/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.less'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
  });

  it('should support less imports', async function () {
    let b = await bundle(__dirname + '/integration/less-import/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.less'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
    assert(css.includes('.base'));
  });

  it('should support linking to assets with url() from less', async function () {
    let b = await bundle(__dirname + '/integration/less-url/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.less'],
        childBundles: [{
          type: 'woff2',
          assets: ['test.woff2'],
          childBundles: []
        }]
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(/url\("[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));

    assert(fs.existsSync(__dirname + '/dist/' + css.match(/url\("([0-9a-f]+\.woff2)"\)/)[1]));
  });

  it('should support transforming less with postcss', async function () {
    let b = await bundle(__dirname + '/integration/less-postcss/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.less'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), '_index_ku5n8_1');

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('._index_ku5n8_1'));
  });

  it('should support requiring sass files', async function () {
    let b = await bundle(__dirname + '/integration/sass/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.sass'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.sass'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
  });

  it('should support requiring scss files', async function () {
    let b = await bundle(__dirname + '/integration/scss/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.scss'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
  });

  it('should support scss imports', async function () {
    let b = await bundle(__dirname + '/integration/scss-import/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.scss'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
    assert(css.includes('.base'));
  });

  it('should support linking to assets with url() from scss', async function () {
    let b = await bundle(__dirname + '/integration/scss-url/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.scss'],
        childBundles: [{
          type: 'woff2',
          assets: ['test.woff2'],
          childBundles: []
        }]
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(/url\("[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));

    assert(fs.existsSync(__dirname + '/dist/' + css.match(/url\("([0-9a-f]+\.woff2)"\)/)[1]));
  });

  it('should support transforming scss with postcss', async function () {
    let b = await bundle(__dirname + '/integration/scss-postcss/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.scss'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), '_index_1a1ih_1');

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('._index_1a1ih_1'));
  });

  it('should minify JS in production mode', async function () {
    let b = await bundle(__dirname + '/integration/uglify/index.js', {production: true});

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let js = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(!js.includes('local.a'));
  });

  it('should minify CSS in production mode', async function () {
    let b = await bundle(__dirname + '/integration/cssnano/index.js', {production: true});

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.local'));
    assert(css.includes('.index'));
    assert(!css.includes('\n'));
  });

  it('should support importing a glob of CSS files', async function () {
    let b = await bundle(__dirname + '/integration/glob-css/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css'],
      childBundles: [{
        name: 'index.css',
        assets: ['index.css', '*.css', 'other.css', 'local.css'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.local'));
    assert(css.includes('.other'));
    assert(css.includes('.index'));
  });

  it('should support importing a URL to a raw asset', async function () {
    let b = await bundle(__dirname + '/integration/import-raw/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: [{
        type: 'txt',
        assets: ['test.txt'],
        childBundles: []
      }]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert(/^[0-9a-f]+\.txt$/.test(output()));
    assert(fs.existsSync(__dirname + '/dist/' + output()));
  });

  it('should support bundling HTML', async function () {
    let b = await bundle(__dirname + '/integration/html/index.html');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [{
        type: 'css',
        assets: ['index.css'],
        childBundles: []
      }, {
        type: 'html',
        assets: ['other.html'],
        childBundles: [{
          type: 'js',
          assets: ['index.js'],
          childBundles: []
        }]
      }]
    });

    let files = fs.readdirSync(__dirname + '/dist');
    let html = fs.readFileSync(__dirname + '/dist/index.html');
    for (let file of files) {
      if (file !== 'index.html') {
        assert(html.includes(file));
      }
    }
  });

  it('should support transforming HTML with posthtml', async function () {
    let b = await bundle(__dirname + '/integration/posthtml/index.html');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: []
    });

    let html = fs.readFileSync(__dirname + '/dist/index.html');
    assert(html.includes('<h1>Other page</h1>'));
  });

  it('should minify HTML in production mode', async function () {
    let b = await bundle(__dirname + '/integration/htmlnano/index.html', {production: true});

    let css = fs.readFileSync(__dirname + '/dist/index.html', 'utf8');
    assert(css.includes('Other page'));
    assert(!css.includes('\n'));
  });

  it('should insert global variables when needed', async function () {
    let b = await bundle(__dirname + '/integration/globals/index.js');

    let output = run(b);
    assert.deepEqual(output(), {
      dir: __dirname + '/integration/globals',
      file: __dirname + '/integration/globals/index.js',
      buf: new Buffer('browser').toString('base64'),
      global: true
    });
  });

  it('should insert environment variables', async function () {
    let b = await bundle(__dirname + '/integration/env/index.js');

    let output = run(b);
    assert.equal(output(), 'test');
  });
});
