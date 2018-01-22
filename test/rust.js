const assert = require('assert');
const {bundle, run, assertBundleTree} = require('./utils');

describe('rust', function() {
  it('should generate a wasm file from a rust file', async function() {
    let b = await bundle(__dirname + '/integration/rust/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'bundle-loader.js',
        'bundle-url.js',
        'index.js',
        'js-loader.js',
        'wasm-loader.js'
      ],
      childBundles: [
        {
          type: 'js',
          assets: ['add.rs'],
          childBundles: [
            {
              type: 'wasm',
              assets: ['add.wasm'],
              childBundles: []
            }
          ]
        }
      ]
    });

    var res = run(b);
    assert.equal(await res, 5);
  });
});
