import path from 'path';
import assert from 'assert';
import {bundle, assertBundles, findAsset} from '@parcel/test-utils';

describe('bundler', function () {
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
    if (process.env.PARCEL_TEST_EXPERIMENTAL_BUNDLER) {
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
    }
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
    if (process.env.PARCEL_TEST_EXPERIMENTAL_BUNDLER) {
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
          .getReferencedBundles(
            b.getBundlesWithAsset(findAsset(b, 'bar.js'))[0],
          )
          .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
      );
      assert(
        b
          .getReferencedBundles(
            b.getBundlesWithAsset(findAsset(b, 'foo.js'))[0],
          )
          .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
      );
    }
  });
  // This test tests partial removal of a rused bundle
  it.skip('should not remove shared bundle from graph if its parent (a reused bundle) is removed by min bundle size', async function () {
    // If minBundleSize dictates a reused bundle should be removed, it should be placed back into the bundlegroups where
    // it acted as a shared bundle (maintiaining any children it had from that)
    if (process.env.PARCEL_TEST_EXPERIMENTAL_BUNDLER) {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/shared-bundle-between-reused-bundle-removal-minBundleSize/index.js',
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
          assets: ['foo.js', 'a.js', 'b.js'],
        },
        {
          assets: ['bar.js', 'foo.js', 'a.js', 'b.js'], // reused (shared bundle) merged back
        },
        {
          assets: ['buzz.js'],
        },
        {
          assets: ['c.js'], // regular shared bundle
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
          .getReferencedBundles(
            b.getBundlesWithAsset(findAsset(b, 'bar.js'))[0],
          )
          .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
      );
    }
  });
  //This test case test partial removal
  it.skip('should remove a reused bundle (from the bundlegroup that contains it as a shared bundle) if its smaller than the minBundleSize', async function () {
    if (process.env.PARCEL_TEST_EXPERIMENTAL_BUNDLER) {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/reused-bundle-remove-min-bundle-size/index.js',
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
          assets: ['foo.js', 'a.js', 'b.js'],
        },
        {
          assets: ['buzz.js'],
        },
        {
          assets: ['c.js'],
        },
        {
          assets: ['styles.css'],
        },
        {
          assets: ['local.html'],
        },
      ]);
    }
  });

  // ALTERNATIVE TESTS FOR REUSED BUNDLES (i.e. removing them fully)
  it('should not remove shared bundle from graph if its parent (a reused bundle) is removed by min bundle size', async function () {
    // If minBundleSize dictates a reused bundle should be removed, it should be placed back into the bundlegroups where
    // it acted as a shared bundle (maintiaining any children it had from that)
    if (process.env.PARCEL_TEST_EXPERIMENTAL_BUNDLER) {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/shared-bundle-between-reused-bundle-removal-minBundleSize/index.js',
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
            'foo.js',
            'a.js',
            'b.js',
          ],
        },
        {
          assets: ['bar.js', 'foo.js', 'a.js', 'b.js'], // reused (shared bundle) merged back
        },
        {
          assets: ['buzz.js'],
        },
        {
          assets: ['c.js'], // regular shared bundle
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
          .getReferencedBundles(
            b.getBundlesWithAsset(findAsset(b, 'bar.js'))[0],
          )
          .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
      );
      assert(
        b
          .getReferencedBundles(
            b.getBundlesWithAsset(findAsset(b, 'index.js'))[0],
          )
          .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
      );
    }
  });
  it('should remove a reused bundle (from the bundlegroup that contains it as a shared bundle) if its smaller than the minBundleSize', async function () {
    if (process.env.PARCEL_TEST_EXPERIMENTAL_BUNDLER) {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/reused-bundle-remove-min-bundle-size/index.js',
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
            'foo.js',
            'a.js',
            'b.js',
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
          assets: ['styles.css'],
        },
        {
          assets: ['local.html'],
        },
      ]);
      assert(
        b
          .getReferencedBundles(
            b.getBundlesWithAsset(findAsset(b, 'bar.js'))[0],
          )
          .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
      );
      assert(
        !b
          .getReferencedBundles(
            b.getBundlesWithAsset(findAsset(b, 'index.js'))[0],
          )
          .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
      );
    }
  });

  //TODO: Add case where a reused bundle has a non shared child AND gets removed by min bundle size. Child should still exist and not have source bundles
  //TODO: Add case where a bundle has a different parent but is to be removed by minBundleSize, we should only remove it from bundles that are not part of that
  // different type bundle parent
  it('should NOT remove a reused bundle if it has a different type parent even if its smaller than the minBundleSize', async function () {
    if (process.env.PARCEL_TEST_EXPERIMENTAL_BUNDLER) {
      let b = await bundle(
        path.join(
          __dirname,
          'integration/reused-bundle-remove-min-bundle-size/index.js',
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
            'foo.js',
            'a.js',
            'b.js',
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
          assets: ['styles.css'],
        },
        {
          assets: ['local.html'],
        },
      ]);
      assert(
        b
          .getReferencedBundles(
            b.getBundlesWithAsset(findAsset(b, 'bar.js'))[0],
          )
          .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
      );
      assert(
        !b
          .getReferencedBundles(
            b.getBundlesWithAsset(findAsset(b, 'index.js'))[0],
          )
          .includes(b.getBundlesWithAsset(findAsset(b, 'c.js'))[0]),
      );
    }
  });
});
