const assert = require('assert');
const {bundle, run, assertBundleTree} = require('./utils');

describe('wasm', function() {
  it('should inline a wasm file into JS', async function() {
    let b = await bundle(__dirname + '/integration/wasm/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'add.wasm'],
      childBundles: [
        {
          type: 'wasm',
          assets: ['add.wasm'],
          childBundles: []
        }
      ]
    });

    let output = run(b);
    assert.equal(output, 5);
  });
});
