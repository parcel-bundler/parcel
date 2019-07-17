const assert = require('assert');
const path = require('path');
const {
  bundle,
  run,
  assertBundles,
  distDir,
  outputFS
} = require('@parcel/test-utils');

describe('stylus', function() {
  it('should support requiring stylus files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/stylus/index.js'));

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.styl']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.index'));
  });

  it('should support requiring stylus files with dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-deps/index.js')
    );

    // a.styl shouldn't be included as a dependency that we can see.
    // stylus takes care of inlining it.
    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.styl']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.index'));
    assert(css.includes('.a'));
    assert(css.includes('-webkit-box'));
    assert(css.includes('.foo'));
  });

  it('should support linking to assets with url() from stylus', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-url/index.js')
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.styl']
      },
      {
        type: 'woff2',
        assets: ['test.woff2']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(/url\("\/test\.[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));

    assert(
      await outputFS.exists(
        path.join(distDir, css.match(/url\("\/(test\.[0-9a-f]+\.woff2)"\)/)[1])
      )
    );
  });

  it('should support transforming stylus with css modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-postcss/index.js')
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'index.module.styl']
      },
      {
        name: 'index.css',
        assets: ['index.module.styl']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(output().startsWith('_index_'));

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('._index_'));
  });

  it('should support requiring stylus files with glob dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-glob-import/index.js')
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.styl']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.index'));
    assert(css.includes('.main'));
    assert(css.includes('.foo'));
    assert(css.includes('.bar'));
  });
});
