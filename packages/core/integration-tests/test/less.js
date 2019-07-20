const assert = require('assert');
const path = require('path');
const {bundle, run, assertBundleTree, outputFS} = require('@parcel/test-utils');

describe.skip('less', function() {
  it('should support requiring less files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/less/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.less'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('.index'));
  });

  it('should support less imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-import/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.less'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('.index'));
    assert(css.includes('.base'));
  });

  it('should support advanced less imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-advanced-import/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.less'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('.index'));
    assert(css.includes('.base'));
  });

  it('should support requiring empty less files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-empty/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.less'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

    let css = await outputFS.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(
      /^\/\*# sourceMappingURL=\/\w*\.css\.map \*\/$/.test(
        css.replace('\n', '')
      )
    );
  });

  it('should support linking to assets with url() from less', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-url/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.less'],
          childBundles: [
            {
              type: 'map'
            }
          ]
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

    let css = await outputFS.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(/url\("test\.[0-9a-f]+\.woff2"\)/.test(css));
    assert(css.includes('url("http://google.com")'));
    assert(css.includes('.index'));

    assert(
      await outputFS.exists(
        path.join(
          __dirname,
          '/dist/',
          css.match(/url\("(test\.[0-9a-f]+\.woff2)"\)/)[1]
        )
      )
    );
  });

  it('should support transforming less with postcss', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/less-postcss/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.less'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.less'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(output().startsWith('_index_'));

    let css = await outputFS.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(css.includes('._index_'));
  });
});
