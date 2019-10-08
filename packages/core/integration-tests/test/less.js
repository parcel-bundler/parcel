import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  assertBundles,
  distDir,
  outputFS
} from '@parcel/test-utils';

describe('less', function() {
  it('should support requiring less files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/less/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.less']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.index'));
  });

  it('should support less imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-import/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.less']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.a'));
    assert(css.includes('.b'));
    assert(css.includes('.c'));
    assert(css.includes('.d'));
  });

  it('should support advanced less imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-advanced-import/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.less']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');

    assert(css.includes('.a'));
    assert(css.includes('.external-index'));
    assert(css.includes('.external-a'));
    assert(css.includes('.external-with-main'));
    assert(css.includes('.explicit-external-a'));
  });

  it('should support requiring empty less files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-empty/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.less']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert.equal(css, '');
  });

  it('should support linking to assets with url() from less', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-url/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.less']
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

  it('should support transforming less with postcss', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-postcss/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'index.module.less']
      },
      {
        name: 'index.css',
        assets: ['index.module.less']
      },
      {
        assets: ['img.svg']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(output().startsWith('_index_'));

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('._index_'));
  });

  it('should throw an exception when using webpack syntax', async function() {
    let didThrow = false;

    try {
      await bundle(
        path.join(__dirname, '/integration/less-webpack-import-error/index.js')
      );
    } catch (err) {
      assert.equal(
        err.message,
        'The @import path "~library/style.less" is using webpack specific syntax, which isn\'t supported by Parcel.\n\nTo @import files from node_modules, use "library/style.less"'
      );
      didThrow = true;
    }

    assert(didThrow);
  });

  it('should support configuring less include paths', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-include-paths/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.less']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.a'));
    assert(css.includes('.b'));
  });
});
