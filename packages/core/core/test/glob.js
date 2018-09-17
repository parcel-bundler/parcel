const assert = require('assert');
const fs = require('../src/utils/fs');
const path = require('path');
const {bundle, run, assertBundleTree} = require('./utils');

describe('glob', function() {
  it('should require a glob of files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/glob/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', '*.js', 'a.js', 'b.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should require nested directories with a glob', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-deep/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', '*.js', 'a.js', 'b.js', 'c.js', 'z.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 13);
  });

  it('should support importing a glob of CSS files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/glob-css/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css', '*.css', 'other.css', 'local.css'],
      childBundles: [
        {
          name: 'index.css',
          assets: ['index.css', 'other.css', 'local.css'],
          childBundles: []
        },
        {
          type: 'map'
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
    assert(css.includes('.local'));
    assert(css.includes('.other'));
    assert(css.includes('.index'));
  });
});
