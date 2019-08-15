const assert = require('assert');
const {
  bundle,
  assertBundles,
  outputFS,
  distDir
} = require('@parcel/test-utils');
const path = require('path');

describe('sugarss', function() {
  it('should correctly parse SugarSS asset', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sugarss/index.sss')
    );

    await assertBundles(b, [
      {
        name: 'index.css',
        assets: ['index.sss']
      }
    ]);

    let cssContent = await outputFS.readFile(
      path.join(distDir, '/index.css'),
      'utf8'
    );
    assert(cssContent.includes('{'));
  });
});
