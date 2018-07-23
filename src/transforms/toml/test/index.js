const assert = require('assert');
const fs = require('@parcel/fs');
const {bundle, run, assertBundleTree} = require('@parcel/test-utils');

describe('toml', function () {
  it('should support requiring TOML files', async function() {
    let b = await bundle(__dirname + '/fixtures/toml/index.js');

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.toml'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should minify TOML for production', async function() {
    let b = await bundle(__dirname + '/fixtures/toml/index.js', {
      scopeHoist: false,
      production: true
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let json = await fs.readFile(__dirname + '/dist/index.js', 'utf8');
    assert(json.includes('{a:1,b:{c:2}}'));
  });
});
