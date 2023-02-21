import assert from 'assert';
import path from 'path';
import {
  bundle,
  run,
  assertBundles,
  distDir,
  outputFS,
} from '@parcel/test-utils';

describe('stylus', function () {
  it('should support requiring stylus files', async function () {
    let b = await bundle(path.join(__dirname, '/integration/stylus/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['index.styl'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.index'));
  });

  it('should support requiring stylus files with dependencies', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-deps/index.js'),
    );

    // a.styl shouldn't be included as a dependency that we can see.
    // stylus takes care of inlining it.
    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['index.styl'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.index'));
    assert(css.includes('.a'));
    assert(css.includes('.b'));
    assert(css.includes('-webkit-box'));
    assert(css.includes('.foo'));
  });

  it('should support linking to assets with url() from stylus', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-url/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['index.styl'],
      },
      {
        type: 'woff2',
        assets: ['test.woff2'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(/url\("?test\.[0-9a-f]+\.woff2"?\)/.test(css));
    assert(/url\("?http:\/\/google.com"?\)/.test(css));
    assert(css.includes('.index'));

    assert(
      await outputFS.exists(
        path.join(distDir, css.match(/url\("?(test\.[0-9a-f]+\.woff2)"?\)/)[1]),
      ),
    );
  });

  it('should ignore paths starting with "#" when resolving with stylus url()', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-id-url/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['index.styl'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('#clip-path'));
    assert(css.includes('.svg-background'));
  });

  it('should support transforming stylus with css modules', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-postcss/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'index.module.styl'],
      },
      {
        name: 'index.css',
        assets: ['index.module.styl'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(output().endsWith('_index'));

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(/\.[_0-9a-zA-Z]+_index/.test(css));
  });

  it('should support requiring stylus files with glob dependencies', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/stylus-glob-import/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
      {
        name: 'index.css',
        assets: ['index.styl'],
      },
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

  it('should support the stylus package exports condition', async function () {
    await bundle(
      path.join(__dirname, '/integration/stylus-exports/index.styl'),
    );

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('.a'));
  });
});
