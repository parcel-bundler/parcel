const assert = require('assert');
const fs = require('@parcel/fs');
const {bundle, assertBundleTree, run} = require('./utils');

describe('kotlin', function() {
  it('should produce a basic kotlin bundle', async function() {
    let b = await bundle(__dirname + '/integration/kotlin/index.js');

    await assertBundleTree(b, {
      type: 'js',
      assets: ['test.kt', 'index.js', 'browser.js', 'kotlin.js']
    });

    let output = await run(b);
    assert.equal(output, 5);
  });
});
