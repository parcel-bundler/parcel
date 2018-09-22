const assert = require('assert');
const path = require('path');
const {bundle, run, assertBundleTree} = require('./utils');

describe('plugins', function() {
  it('should load plugins and apply custom asset type', async function() {
    let b = await bundle(path.join(__dirname, '/integration/plugins/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(output, 'hello world');
  });

  it('should load package.json from parent tree', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/plugins/sub-folder/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(output, 'hello world');
  });
});
