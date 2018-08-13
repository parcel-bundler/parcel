const assert = require('assert');
const fs = require('@parcel/fs');
const {bundle, run, assertBundleTree} = require('@parcel/test-utils');

describe('yaml', function () {
  it('should support requiring YAML files', async function() {
    let b = await bundle(__dirname + '/fixtures/yaml/index.js');

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.yaml'],
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

  it('should minify YAML for production', async function() {
    let b = await bundle(__dirname + '/fixtures/yaml/index.js', {
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
