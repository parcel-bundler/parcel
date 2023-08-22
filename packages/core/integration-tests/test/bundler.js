import path from 'path';
import assert from 'assert';
import Logger from '@parcel/logger';
import {bundle, assertBundles, findAsset} from '@parcel/test-utils';

describe('bundler', function () {
  it('should create shared bundles when disableSharedBundles is not set', async function () {
    let b = await bundle(
      path.join(
        __dirname,
        'integration/disable-shared-bundles-default/index.js',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['foo.js'],
      },
      {
        assets: ['bar.js'],
      },
      {
        assets: ['a.js', 'b.js'],
      },
    ]);
  });

  it('should not create shared bundles when disableSharedBundles is set to true', async function () {
    let b = await bundle(
      path.join(__dirname, 'integration/disable-shared-bundles-true/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['foo.js', 'a.js', 'b.js'],
      },
      {
        assets: ['bar.js', 'a.js', 'b.js'],
      },
    ]);
  });

  it('should create shared bundles when disableSharedBundles is set to false', async function () {
    let b = await bundle(
      path.join(__dirname, 'integration/disable-shared-bundles-false/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['foo.js'],
      },
      {
        assets: ['bar.js'],
      },
      {
        assets: ['a.js', 'b.js'],
      },
    ]);
  });

  it('should not count inline assests towards parallel request limit', async function () {
    // Shared bundle should not be removed in this case
    let b = await bundle(
      path.join(__dirname, 'integration/inlined-assests/local.html'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        assets: ['local.html'],
      },
      {
        assets: ['buzz.js'],
      },
      {
        assets: [
          'inline-module.js',
          'local.html',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
        ],
      },
      {
        assets: ['esmodule-helpers.js'],
      },
    ]);
  });

  it('should not create a shared bundle from an asset if that asset is shared by less than minBundles bundles', async function () {
    let b = await bundle(
      path.join(__dirname, 'integration/min-bundles/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'css-loader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        // a and b are shared between only 2 bundles so they are kept in each bundle
        assets: ['bar.js', 'a.js', 'b.js'],
      },
      {
        assets: ['buzz.js'],
      },
      {
        assets: ['a.js', 'b.js', 'foo.js'],
      },
      {
        // c is shared between 3 different bundles, so it stays
        assets: ['c.js'],
      },
      {
        assets: ['styles.css'],
      },
      {
        assets: ['local.html'],
      },
    ]);
  });

  it('should remove reused bundle (over shared bundles based on size) if the bundlegroup hit the parallel request limit', async function () {
    let b = await bundle(
      path.join(
        __dirname,
        'integration/shared-bundle-reused-bundle-remove-reuse/index.js',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'css-loader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['bar.js', 'foo.js', 'a.js', 'b.js'],
      },
      {
        assets: ['buzz.js'],
      },
      {
        assets: ['c.js'],
      },
      {
        assets: ['a.js', 'b.js', 'foo.js'],
      },
      {
        assets: ['styles.css'],
      },
      {
        assets: ['local.html'],
      },
    ]);
  });

  //This test case is the same as previous except we remove the shared bundle since it is smaller
  it('should remove shared bundle (over reused bundles based on size) if the bundlegroup hit the parallel request limit', async function () {
    let b = await bundle(
      path.join(
        __dirname,
        'integration/shared-bundle-reused-bundle-remove-shared/index.js',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'css-loader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['bar.js', 'c.js'],
      },
      {
        // A consequence of our shared bundle 'c'  being removed for the bundleGroup bar
        // is that it must also be removed for buzz, even though the buzz bundleGroup does not
        // hit the parallel request limit. This is because the shared bundle is no longer sharing
        // it is only attached to one bundle and thus should be removed.
        assets: ['buzz.js', 'c.js'],
      },
      {
        assets: ['a.js', 'b.js', 'foo.js'],
      },
      {
        assets: ['styles.css'],
      },
      {
        assets: ['local.html'],
      },
    ]);
  });

  it('should not remove shared bundle from graph if one bundlegroup hits the parallel request limit, and at least 2 other bundleGroups that need it do not', async function () {
    //The shared bundle should only be 'put back' for the bundlegroups which hit the parallel request limit
    // But if there are at least two other bundlegroups using this shared bundle that do not hit the max limit
    // the shared bundle should not be removed from the graph
    let b = await bundle(
      path.join(
        __dirname,
        'integration/shared-bundle-remove-from-one-group-only/index.js',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'css-loader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['bar.js', 'c.js'], // shared bundle merged back
      },
      {
        assets: ['buzz.js'],
      },
      {
        assets: ['c.js'], // shared bundle
      },
      {
        assets: ['foo.js'],
      },
      {
        assets: ['styles.css'],
      },
      {
        assets: ['local.html'],
      },
    ]);
  });

  it('should not remove shared bundle from graph if its parent (a reused bundle) is removed by parallel request limit', async function () {
    //The shared bundle should only be 'put back' for the bundlegroups which hit the parallel request limit
    // But if there are at least two other bundlegroups using this shared bundle that do not hit the max limit
    // the shared bundle should not be removed from the graph
    let b = await bundle(
      path.join(
        __dirname,
        'integration/shared-bundle-between-reused-bundle-removal/index.js',
      ),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'css-loader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['bar.js', 'foo.js', 'a.js', 'b.js'], // shared bundle merged back
      },
      {
        assets: ['buzz.js'],
      },
      {
        assets: ['c.js'], // shared bundle
      },
      {
        assets: ['foo.js', 'a.js', 'b.js'],
      },
      {
        assets: ['styles.css'],
      },
      {
        assets: ['local.html'],
      },
    ]);

    assert(
      b
        .getReferencedBundles(b.getBundlesWithAsset(findAsset(b, 'bar.js'))[0])
        .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
    );
  });

  it('should split manifest bundle', async function () {
    let b = await bundle(
      [
        path.join(__dirname, 'integration/split-manifest-bundle/a.html'),
        path.join(__dirname, 'integration/split-manifest-bundle/b.html'),
      ],
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
          shouldOptimize: false,
        },
      },
    );

    // There should be two manifest bundles added, one for a.js, one for b.js
    assertBundles(b, [
      {
        assets: ['a.html'],
      },
      {
        assets: ['b.html'],
      },
      {
        assets: ['a.js', 'cacheLoader.js', 'js-loader.js'],
      },
      {
        assets: ['bundle-manifest.js', 'bundle-url.js'], // manifest bundle
      },
      {
        assets: [
          'b.js',
          'cacheLoader.js',
          'js-loader.js',
          'esmodule-helpers.js',
        ],
      },
      {
        assets: ['bundle-manifest.js', 'bundle-url.js'], // manifest bundle
      },
      {
        assets: ['c.js'],
      },
    ]);

    let aManifestBundle = b
      .getBundles()
      .find(
        bundle => !bundle.getMainEntry() && bundle.name.includes('runtime'),
      );

    let bBundles = b
      .getBundles()
      .filter(bundle => /b\.HASH_REF/.test(bundle.name));

    let aBundleManifestAsset;
    aManifestBundle.traverseAssets((asset, _, {stop}) => {
      if (/runtime-[a-z0-9]{16}\.js/.test(asset.filePath)) {
        aBundleManifestAsset = asset;
        stop();
      }
    });
    let aBundleManifestAssetCode = await aBundleManifestAsset.getCode();

    // Assert the a.js manifest bundle is aware of all the b.js bundles
    for (let bundle of bBundles) {
      assert(
        aBundleManifestAssetCode.includes(bundle.name),
        `Bundle should contain reference to: "${bundle.name}"`,
      );
    }
  });

  it('should not split manifest bundle for stable entries', async function () {
    let b = await bundle(
      path.join(__dirname, 'integration/split-manifest-bundle/a.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: false,
        },
      },
    );

    assertBundles(b, [
      {
        assets: [
          'a.js',
          'b.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'esmodule-helpers.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['c.js'],
      },
    ]);
  });
});
