const assert = require('assert');
const path = require('path');
const {bundle, assertBundles, outputFS} = require('@parcel/test-utils');

describe('webmanifest', function() {
  it('should support .webmanifest', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/webmanifest/index.html'),
    );

    await assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        name: 'manifest.webmanifest',
        type: 'webmanifest',
        assets: ['manifest.webmanifest'],
      },
      {
        type: 'png',
        assets: ['icon.png'],
      },
      {
        type: 'png',
        assets: ['screenshot.png'],
      },
    ]);

    const manifest = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'webmanifest').filePath,
      'utf8',
    );
    assert(/screenshot\.[0-9a-f]+\.png/.test(manifest));
    assert(/icon\.[0-9a-f]+\.png/.test(manifest));
  });
});
