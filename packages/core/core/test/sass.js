const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const {bundle, run, assertBundleTree} = require('./utils');

describe('sass', function() {
  it('should support requiring sass files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/sass/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.sass'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.sass'],
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

  it('should support requiring scss files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/scss/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.scss'],
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

  it('should support scss imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/scss-import/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.scss'],
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
    assert(css.includes('.foo'));
    assert(css.includes('.bar'));
  });

  it('should support requiring empty scss files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/scss-empty/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.scss'],
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
    assert.equal(css, '');
  });

  it('should support linking to assets with url() from scss', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/scss-url/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [
        {
          type: 'jpeg',
          assets: ['image.jpeg'],
          childBundles: []
        },
        {
          type: 'map'
        },
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

  it('should support transforming scss with postcss', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/scss-postcss/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.scss'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.scss'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    let className = output();
    assert.notStrictEqual(className, 'index');

    let css = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes(`.${className}`));
  });

  it('should support advanced import syntax', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sass-advanced-import/index.sass')
    );

    await assertBundleTree(b, {
      name: 'index.css',
      assets: ['index.sass']
    });

    let css = (await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    )).replace(/\s+/g, ' ');
    assert(css.includes('.foo { color: blue;'));
    assert(css.includes('.bar { color: green;'));
  });
});
