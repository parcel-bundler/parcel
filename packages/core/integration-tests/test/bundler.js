import path from 'path';
import assert from 'assert';
import {bundle, assertBundles, findAsset} from '@parcel/test-utils';

describe('bundler', function () {
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

  //This test case is the sdame as previous except we remove the shared bundle since it is smaller
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
    }
  });
});
