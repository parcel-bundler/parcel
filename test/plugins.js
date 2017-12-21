const assert = require('assert');
const {bundle, run, assertBundleTree} = require('./utils');

describe('plugins', function() {
  it('should load plugins and apply custom asset type', async function() {
    let b = await bundle(__dirname + '/integration/plugins/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(output, 'hello world');
  });

  it('should load package.json from parent tree', async function() {
    let b = await bundle(
      __dirname + '/integration/plugins/sub-folder/index.js'
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: []
    });

    let output = run(b);
    assert.equal(output, 'hello world');
  });
});
