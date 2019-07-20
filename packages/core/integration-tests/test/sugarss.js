const assert = require('assert');
const {bundle, assertBundleTree, outputFS} = require('@parcel/test-utils');
const path = require('path');

describe.skip('sugarss', function() {
  it('should correctly parse SugarSS asset', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sugarss/index.sss')
    );

    await assertBundleTree(b, {
      name: 'index.css',
      assets: ['index.sss']
    });

    let cssContent = await outputFS.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(cssContent.includes('{'));
  });
});
