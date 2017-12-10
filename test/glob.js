const assert = require('assert');
const fs = require('fs');
const {bundle, run, assertBundleTree} = require('./utils');

describe('glob', function() {
  it('should require a glob of files', async function() {
    let b = await bundle(__dirname + '/integration/glob/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', '*.js', 'a.js', 'b.js'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should require nested directories with a glob', async function() {
    let b = await bundle(__dirname + '/integration/glob-deep/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', '*.js', 'a.js', 'b.js', 'c.js', 'z.js'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 13);
  });

  it('should support importing a glob of CSS files', async function() {
    let b = await bundle(__dirname + '/integration/glob-css/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.css', '*.css', 'other.css', 'local.css'],
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
    assert(css.includes('.index'));
  });
});
