// @flow strict-local
import path from 'path';
import assert from 'assert';
import {distDir, bundle, assertBundles, outputFS} from '@parcel/test-utils';

describe('JS API', function () {
  it('should respect distEntry', async function () {
    const NAME = 'custom-name.js';

    let b = await bundle(
      path.join(__dirname, '/integration/js-comment/index.js'),
      {
        targets: {
          default: {distDir, distEntry: NAME},
        },
      },
    );

    assertBundles(b, [
      {
        name: NAME,
        type: 'js',
        assets: ['index.js'],
      },
    ]);

    assert(await outputFS.exists(path.join(distDir, NAME)));
  });

  it('should run additional reports from the options', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/js-comment/index.js'),
      {
        additionalReporters: [
          {
            packageName: '@parcel/reporter-bundle-buddy',
            resolveFrom: __dirname,
          },
        ],
      },
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.js'],
      },
    ]);

    assert(await outputFS.exists(path.join(distDir, 'bundle-buddy.json')));
  });
});
