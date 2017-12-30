const assert = require('assert');
const {bundle, run} = require('./utils');

describe('elm', function() {
  it('should produce a bundle', async function() {
    let b = await bundle(__dirname + '/integration/elm/index.js');
    assert.equal(b.assets.size, 3);
    assert.equal(b.childBundles.size, 0);

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(typeof output().Main.embed, 'function');
  });
});
