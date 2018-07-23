const assert = require('assert');
const path = require('path');
const {bundle, run, assertBundleTree} = require('@parcel/test-utils');

describe('coffeescript', function () {
  it('should support requiring CoffeeScript files', async function() {
    let b = await bundle(__dirname + '/fixtures/coffee/index.js');

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.coffee'],
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
});
