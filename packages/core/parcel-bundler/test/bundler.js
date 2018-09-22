const assert = require('assert');
const sinon = require('sinon');
const path = require('path');
const {assertBundleTree, bundle, bundler, nextBundle} = require('./utils');

describe('bundler', function() {
  it('should bundle once before exporting middleware', async function() {
    let b = bundler(
      path.join(__dirname, '/integration/bundler-middleware/index.js')
    );
    b.middleware();

    await nextBundle(b);
    assert(b.entryAssets);
  });

  it('should defer bundling if a bundle is pending', async () => {
    const b = bundler(path.join(__dirname, '/integration/html/index.html'));
    b.pending = true; // bundle in progress
    const spy = sinon.spy(b, 'bundle');

    // first bundle, with existing bundle pending
    const bundlePromise = b.bundle();

    // simulate bundle finished
    b.pending = false;
    b.emit('buildEnd');

    // wait for bundle to complete
    await bundlePromise;

    assert(spy.calledTwice);
  });

  it('should enforce asset type path to be a string', () => {
    const b = bundler(path.join(__dirname, '/integration/html/index.html'));

    assert.throws(() => {
      b.addAssetType('.ext', {});
    }, 'should be a module path');
  });

  it('should enforce setup before bundling', () => {
    const b = bundler(path.join(__dirname, '/integration/html/index.html'));
    b.farm = true; // truthy

    assert.throws(() => {
      b.addAssetType('.ext', __filename);
    }, 'before bundling');

    assert.throws(() => {
      b.addPackager('type', 'packager');
    }, 'before bundling');
  });

  it('should support multiple entry points', async function() {
    let b = await bundle([
      path.join(__dirname, '/integration/multi-entry/one.html'),
      path.join(__dirname, '/integration/multi-entry/two.html')
    ]);

    await assertBundleTree(b, [
      {
        type: 'html',
        assets: ['one.html'],
        childBundles: [
          {
            type: 'js',
            assets: ['shared.js']
          }
        ]
      },
      {
        type: 'html',
        assets: ['two.html'],
        childBundles: []
      }
    ]);
  });

  it('should support multiple entry points as a glob', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/multi-entry/*.html')
    );

    await assertBundleTree(b, [
      {
        type: 'html',
        assets: ['one.html'],
        childBundles: [
          {
            type: 'js',
            assets: ['shared.js']
          }
        ]
      },
      {
        type: 'html',
        assets: ['two.html'],
        childBundles: []
      }
    ]);
  });
});
