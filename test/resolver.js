const assert = require('assert');
const {bundle, run, assertBundleTree} = require('./utils');

describe('resolver', function() {
  it('should transfrom "~/" to root of project', async function() {
    let b = await bundle(__dirname + '/integration/path/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.js'],
      childBundles: []
    });

    let output = run(b);

    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });
});
