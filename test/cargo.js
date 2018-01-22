const assert = require('assert');
const {bundle, run, assertBundleTree} = require('./utils');

describe('cargo', function() {
  it('should generate a wasm file from a rust file', async function() {
    let b = await bundle(__dirname + '/integration/cargo/src/index.js');

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
          assets: ['lib.rs'],
          childBundles: [
            {
              type: 'wasm',
              assets: ['cargo.wasm'],
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
