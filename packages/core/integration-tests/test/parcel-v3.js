// @flow

import assert from 'assert';
import {join} from 'path';

import {ParcelV3, toFileSystemV3} from '@parcel/core';
import {NodePackageManager} from '@parcel/package-manager';
import {bundle, fsFixture, inputFS, overlayFS, run} from '@parcel/test-utils';

describe('parcel-v3', function () {
  it.skip('runs in a fs fixture', async () => {
    await fsFixture(overlayFS, __dirname)`
      index.js:
        import { a, b } from './main';

        export default function() {
          return a + b;
        }

      main.js:
        export const a = 1;
        export const b = 2;

      .parcelrc:
        {
          "extends": "@parcel/config-default",
          "transformers": {
            "*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}": ["@parcel/transformer-js"]
          }
        }

      package.json: {}

      yarn.lock: {}
    `;

    let b = await bundle(join(__dirname, 'index.js'), {
      featureFlags: {
        parcelV3: true,
      },
      inputFS: overlayFS,
    });

    // assert.equal(b.assets.size, 8);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('runs', async () => {
    let b = await bundle(join(__dirname, '/integration/parcel-v3/index.js'), {
      featureFlags: {
        parcelV3: true,
      },
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should run the main-thread bootstrap function', async function () {
    await fsFixture(overlayFS, __dirname)`
      index.js:
        console.log('hello world');

      .parcelrc:
        {
          "extends": "@parcel/config-default"
        }

      yarn.lock: {}
    `;

    let parcel = new ParcelV3({
      corePath: '',
      entries: [join(__dirname, 'index.js')],
      fs: toFileSystemV3(overlayFS),
      nodeWorkers: 1,
      packageManager: new NodePackageManager(inputFS, __dirname),
    });

    await parcel.build();
  });
});
