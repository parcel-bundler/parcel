const assert = require('assert');
const {bundle, run} = require('@parcel/test-utils');

describe('reason', function() {
  it('should produce a bundle', async function() {
    let b = await bundle(__dirname + '/fixtures/reason/index.js');

    assert.equal(b.assets.size, 2);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });
});
