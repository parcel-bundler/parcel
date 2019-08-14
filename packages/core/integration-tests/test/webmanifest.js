const assert = require('assert');
const path = require('path');
const {
  bundle,
  assertBundles,
  distDir,
  outputFS
} = require('@parcel/test-utils');

describe('webmanifest', function() {
  it('should support webmanifest', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/webmanifest/index.html')
    );

    await assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html']
      },
      {
        type: 'webmanifest',
        assets: ['manifest.webmanifest']
      },
      {
        type: 'png',
        assets: ['icon.png']
      },
      {
        type: 'png',
        assets: ['screenshot.png']
      },
      {
        type: 'js',
        assets: ['serviceworker.js']
      }
    ]);
  });

  it("should treat webmanifest as an entry module so it doesn't get content hashed", async function() {
    await bundle(path.join(__dirname, '/integration/webmanifest/index.html'));

    const html = await outputFS.readFile(path.join(distDir, 'index.html'));
    assert(html.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  });
});
