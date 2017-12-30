const assert = require('assert');
const fs = require('fs');
const {bundle, run, assertBundleTree} = require('./utils');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));
const rimraf = require('rimraf');

describe('css', function() {
  it('should produce two bundles when importing a CSS file', async function() {
    let b = await bundle(__dirname + '/integration/css/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css', 'local.js', 'local.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css', 'local.css'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support loading a CSS bundle along side dynamic imports', async function() {
    let b = await bundle(__dirname + '/integration/dynamic-css/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css', 'bundle-loader.js', 'bundle-url.js'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css'],
          childBundles: []
        },
        {
          type: 'js',
          assets: ['local.js', 'local.css'],
          childBundles: [
            {
              type: 'css',
              assets: ['local.css'],
              childBundles: []
            }
          ]
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should support importing CSS from a CSS file', async function() {
    let b = await bundle(__dirname + '/integration/css-import/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css', 'other.css', 'local.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css', 'other.css', 'local.css'],
          childBundles: []
        }
      ]
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

  it('should support linking to assets with url() from CSS', async function() {
    let b = await bundle(__dirname + '/integration/css-url/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css'],
          childBundles: []
        },
        {
          type: 'woff2',
          assets: ['test.woff2'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(/url\("[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));
    assert(css.includes('url("data:image/gif;base64,quotes")'));
    assert(css.includes('.quotes'));
    assert(css.includes('url(data:image/gif;base64,no-quote)'));
    assert(css.includes('.no-quote'));

    assert(
      fs.existsSync(
        __dirname + '/dist/' + css.match(/url\("([0-9a-f]+\.woff2)"\)/)[1]
      )
    );
  });

  it('should support transforming with postcss', async function() {
    let b = await bundle(__dirname + '/integration/postcss/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    assert(/_index_[0-9a-z]+_1/.test(value));

    let cssClass = value.match(/(_index_[0-9a-z]+_1)/)[1];

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes(`.${cssClass}`));
  });

  it('should minify CSS in production mode', async function() {
    let b = await bundle(__dirname + '/integration/cssnano/index.js', {
      production: true
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.local'));
    assert(css.includes('.index'));
    assert(!css.includes('\n'));
  });

  it('should automatically install postcss plugins with npm if needed', async function() {
    rimraf.sync(__dirname + '/input');
    await ncp(__dirname + '/integration/autoinstall/npm', __dirname + '/input');
    await bundle(__dirname + '/input/index.css');

    // cssnext was installed
    let package = require('./input/package.json');
    assert(package.devDependencies['postcss-cssnext']);

    // cssnext is applied
    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('rgba'));
  });

  it('should automatically install postcss plugins with yarn if needed', async function() {
    rimraf.sync(__dirname + '/input');
    await ncp(
      __dirname + '/integration/autoinstall/yarn',
      __dirname + '/input'
    );
    await bundle(__dirname + '/input/index.css');

    // cssnext was installed
    let package = require('./input/package.json');
    assert(package.devDependencies['postcss-cssnext']);

    // appveyor is not currently writing to the yarn.lock file and will require further investigation
    // let lockfile = fs.readFileSync(__dirname + '/input/yarn.lock', 'utf8');
    // assert(lockfile.includes('postcss-cssnext'));

    // cssnext is applied
    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('rgba'));
  });
});
