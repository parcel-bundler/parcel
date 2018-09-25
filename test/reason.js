const assert = require('assert');
const path = require('path');
const {bundle, run} = require('./utils');

describe('reason', function() {
  it('should produce a bundle', async function() {
    let b = await bundle(path.join(__dirname, '/integration/reason/index.js'));

    assert.equal(b.assets.size, 2);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });
});
