import assert from 'assert';
import {
  bundle,
  assertBundles,
  removeDistDirectory,
  distDir,
  outputFS,
} from '@parcel/test-utils';
import path from 'path';

describe('posthtml', function() {
  afterEach(async () => {
    await removeDistDirectory();
  });

  it('should support transforming HTML with posthtml', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/posthtml/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(path.join(distDir, 'index.html'));
    assert(html.includes('<h1>Other page</h1>'));
  });

  it('should find assets inside posthtml', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/posthtml-assets/index.html'),
    );

    assertBundles(b, [
      {
        type: 'html',
        assets: ['index.html'],
      },
      {
        type: 'js',
        assets: ['index.js'],
      },
    ]);
  });

  it('Should be able to process an html file with plugins without any params for plugin', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/posthtml-plugins/index.html'),
    );

    assertBundles(b, [
      {
        type: 'html',
        assets: ['index.html'],
      },
    ]);

    let html = await outputFS.readFile(
      path.join(distDir, 'index.html'),
      'utf-8',
    );
    assert(
      html.includes(
        '&#115;&#97;&#109;&#64;&#115;&#109;&#105;&#116;&#104;&#46;&#99;&#111;&#109;',
      ),
    );
    assert(!html.includes('sam@smith.com'));
  });

  it.skip('should add dependencies referenced by posthtml-include', async () => {
    const b = await bundle(
      path.join(__dirname, '/integration/posthtml-assets/index.html'),
    );
    const asset = b.assets.values().next().value;
    const other = path.join(
      __dirname,
      '/integration/posthtml-assets/other.html',
    );
    assert(asset.dependencies.has(other));
    assert(asset.dependencies.get(other).includedInParent);
  });

  it.skip('should add dependencies referenced by plugins', async () => {
    const b = await bundle(
      path.join(__dirname, '/integration/posthtml-plugin-deps/index.html'),
    );
    const asset = b.assets.values().next().value;
    const other = path.join(
      __dirname,
      '/integration/posthtml-plugin-deps/base.html',
    );
    assert(asset.dependencies.has(other));
    assert(asset.dependencies.get(other).includedInParent);
  });
});
