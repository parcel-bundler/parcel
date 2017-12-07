const assert = require('assert');
const fs = require('fs');
const {bundle, run, assertBundleTree} = require('./utils');

describe('typescript', function () {
  it('should produce a ts bundle', async function () {
    let b = await bundle(__dirname + '/integration/typescript/index.ts');

    assert.equal(b.assets.size, 2);
    assert.equal(b.childBundles.size, 0);

    let output = run(b);
    assert.equal(typeof output.count, 'function');
    assert.equal(output.count(), 3);
  });
});
