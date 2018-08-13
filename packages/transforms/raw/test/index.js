const assert = require('assert');
const fs = require('@parcel/fs');
const {bundle, run, assertBundleTree} = require('@parcel/test-utils');

describe('raw', function () {
  it('should support importing a URL to a raw asset', async function() {
    let b = await bundle(__dirname + '/fixtures/import-raw/index.js');

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: [
        {
          type: 'map'
        },
        {
          type: 'txt',
          assets: ['test.txt'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(/^\/test\.[0-9a-f]+\.txt$/.test(output()));
    assert(await fs.exists(__dirname + '/dist/' + output()));
  });

  it('should dynamic import files which import raw files', async function() {
    let b = await bundle(
      __dirname + '/fixtures/dynamic-references-raw/index.js'
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'bundle-loader.js', 'bundle-url.js', 'js-loader-browser.js'],
      childBundles: [
        {
          type: 'map'
        },
        {
          assets: ['local.js', 'test.txt'],
          childBundles: [
            {
              type: 'map'
            },
            {
              assets: ['test.txt']
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });
});
