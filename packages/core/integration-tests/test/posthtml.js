const assert = require('assert');
const fs = require('@parcel/fs');
const {bundle, assertBundles, assertBundleTree} = require('@parcel/test-utils');
const path = require('path');

describe.skip('posthtml', function() {
  it('should support transforming HTML with posthtml', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/posthtml/index.html')
    );

    await assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      }
    ]);

    let html = await fs.readFile(path.join(__dirname, '/dist/index.html'));
    assert(html.includes('<h1>Other page</h1>'));
  });

  it('should find assets inside posthtml', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/posthtml-assets/index.html')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'js',
          assets: ['index.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should add dependencies referenced by posthtml-include', async () => {
    const b = await bundle(
      path.join(__dirname, '/integration/posthtml-assets/index.html')
    );
    const asset = b.assets.values().next().value;
    const other = path.join(
      __dirname,
      '/integration/posthtml-assets/other.html'
    );
    assert(asset.dependencies.has(other));
    assert(asset.dependencies.get(other).includedInParent);
  });

  it('should add dependencies referenced by plugins', async () => {
    const b = await bundle(
      path.join(__dirname, '/integration/posthtml-plugin-deps/index.html')
    );
    const asset = b.assets.values().next().value;
    const other = path.join(
      __dirname,
      '/integration/posthtml-plugin-deps/base.html'
    );
    assert(asset.dependencies.has(other));
    assert(asset.dependencies.get(other).includedInParent);
  });
});
