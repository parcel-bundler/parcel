const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const {bundle, run, assertBundleTree} = require('./utils');

describe('stylus', function() {
  it('should support requiring stylus files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/stylus/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.styl'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.styl'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('.index'));
  });

  it('should support requiring stylus files with dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-deps/index.js')
    );

    // a.styl shouldn't be included as a dependency that we can see.
    // stylus takes care of inlining it.
    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.styl'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.styl'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('.index'));
    assert(css.includes('.a'));
    assert(css.includes('-webkit-box'));
    assert(css.includes('.foo'));
  });

  it('should support linking to assets with url() from stylus', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-url/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.styl'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.styl'],
          childBundles: []
        },
        {
          type: 'woff2',
          assets: ['test.woff2'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(/url\("test\.[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));

    assert(
      await fs.exists(
        path.join(
          __dirname,
          '/dist/',
          css.match(/url\("(test\.[0-9a-f]+\.woff2)"\)/)[1]
        )
      )
    );
  });

  it('should support transforming stylus with postcss', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-postcss/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.styl'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.styl'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), '_index_g9mqo_1');

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('._index_g9mqo_1'));
  });

  it('should support requiring stylus files with glob dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-glob-import/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.styl'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.styl'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('.index'));
    assert(css.includes('.main'));
    assert(css.includes('.foo'));
    assert(css.includes('.bar'));
  });
});
