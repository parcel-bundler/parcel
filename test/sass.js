const assert = require('assert');
const fs = require('fs');
const {bundle, run, assertBundleTree} = require('./utils');

describe('sass', function() {
  it('should support requiring sass files', async function() {
    let b = await bundle(__dirname + '/integration/sass/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.sass'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.sass'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
  });

  it('should support requiring scss files', async function() {
    let b = await bundle(__dirname + '/integration/scss/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.scss'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
  });

  it('should support scss imports', async function() {
    let b = await bundle(__dirname + '/integration/scss-import/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.scss'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('.index'));
    assert(css.includes('.base'));
  });

  it('should support linking to assets with url() from scss', async function() {
    let b = await bundle(__dirname + '/integration/scss-url/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.scss'],
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

    assert(
      fs.existsSync(
        __dirname + '/dist/' + css.match(/url\("([0-9a-f]+\.woff2)"\)/)[1]
      )
    );
  });

  it('should support transforming scss with postcss', async function() {
    let b = await bundle(__dirname + '/integration/scss-postcss/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.scss'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), '_index_1a1ih_1');

    let css = fs.readFileSync(__dirname + '/dist/index.css', 'utf8');
    assert(css.includes('._index_1a1ih_1'));
  });
});
