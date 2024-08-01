import assert from 'assert';
import {
  assertBundles,
  bundle,
  describe,
  distDir,
  it,
  outputFS,
} from '@parcel/test-utils';
import path from 'path';

describe.v2('sugarss', function () {
  it('should correctly parse SugarSS asset', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/sugarss/index.sss'),
    );

    assertBundles(b, [
      {
        name: 'index.css',
        assets: ['index.sss'],
      },
    ]);

    let cssContent = await outputFS.readFile(
      path.join(distDir, '/index.css'),
      'utf8',
    );
    assert(cssContent.includes('{'));
  });
});
