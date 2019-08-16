const assert = require('assert');
const path = require('path');
const {
  bundle,
  assertBundles,
  distDir,
  outputFS,
} = require('@parcel/test-utils');

describe('pwa-manifest', function() {
  it('should support .webmanifest', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/pwa-manifest/index.html'),
    );

    await assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
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
      {
        type: 'js',
        assets: ['serviceworker.js'],
      },
    ]);
  });

  it('should support .json webmanifest', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/pwa-manifest-json/index.html'),
    );

    await assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'webmanifest',
        assets: ['manifest.json'],
      },
      {
        type: 'png',
        assets: ['icon.png'],
      },
    ]);
  });

  it("should treat .webmanifest as an entry module so it doesn't get content hashed", async function() {
    await bundle(path.join(__dirname, '/integration/pwa-manifest/index.html'));

    const html = await outputFS.readFile(path.join(distDir, 'index.html'));
    assert(html.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  });

  // to prevent infinite loop `.json` -> `.webmanifest`
  it('should rename webmanifest *.json to *.webmanifest', async function() {
    await bundle(
      path.join(__dirname, '/integration/pwa-manifest-json/index.html'),
    );

    const html = await outputFS.readFile(path.join(distDir, 'index.html'));
    assert(html.includes('<link rel="manifest" href="/manifest.webmanifest">'));
  });
});
