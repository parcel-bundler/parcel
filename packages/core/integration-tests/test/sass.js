import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  assertBundles,
  distDir,
  outputFS
} from '@parcel/test-utils';

describe('sass', function() {
  it('should support requiring sass files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/sass/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.sass']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.index'));
  });

  it('should support requiring scss files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/scss/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.scss']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.index'));
  });

  it('should support scss imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/scss-import/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.scss']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.index'));
    assert(css.includes('.foo'));
    assert(css.includes('.bar'));
  });

  it('should support requiring empty scss files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/scss-empty/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        name: 'index.css',
        assets: ['index.scss']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert.equal(css, '');
  });

  it('should support linking to assets with url() from scss', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/scss-url/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        type: 'jpeg',
        assets: ['image.jpeg']
      },
      {
        name: 'index.css',
        assets: ['index.scss']
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
        path.join(distDir, css.match(/url\("(\/test\.[0-9a-f]+\.woff2)"\)/)[1])
      )
    );
  });

  it('should support transforming scss with postcss', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/scss-postcss/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'index.module.scss']
      },
      {
        name: 'index.css',
        assets: ['index.module.scss']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    let className = output();
    assert.notStrictEqual(className, 'index');

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes(`.${className}`));
  });

  it('should support advanced import syntax', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sass-advanced-import/index.sass')
    );

    assertBundles(b, [
      {
        name: 'index.css',
        assets: ['index.sass']
      }
    ]);

    let css = (await outputFS.readFile(
      path.join(distDir, 'index.css'),
      'utf8'
    )).replace(/\s+/g, ' ');
    assert(css.includes('.foo { color: blue;'));
    assert(css.includes('.bar { color: green;'));
  });

  it('should support absolute imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/scss-absolute-imports/style.scss')
    );

    assertBundles(b, [
      {
        name: 'style.css',
        assets: ['style.scss']
      }
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'style.css'), 'utf8');
    assert(css.includes('.a'));
    assert(css.includes('.b'));
  });

  it('should throw an exception when using webpack syntax', async function() {
    let didThrow = false;
    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/sass-webpack-import-error/index.sass'
        )
      );
    } catch (err) {
      assert.equal(
        err.message,
        `
The @import path "~library/style.sass" is using webpack specific syntax, which isn't supported by Parcel.

To @import files from node_modules, use "library/style.sass"
  ╷
1 │ @import "~library/style.sass"
  │         ^^^^^^^^^^^^^^^^^^^^^
  ╵
  test${path.sep}integration${path.sep}sass-webpack-import-error${
          path.sep
        }index.sass 1:9  root stylesheet`.trim()
      );
      didThrow = true;
    }

    assert(didThrow);
  });

  it('should support node_modules imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sass-node-modules-import/index.sass')
    );

    assertBundles(b, [
      {
        name: 'index.css',
        assets: ['index.sass']
      }
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.external'));
  });

  it('should support imports from includePaths', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sass-include-paths-import/index.sass')
    );

    assertBundles(b, [
      {
        name: 'index.css',
        assets: ['index.sass']
      }
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.included'));
  });
});
