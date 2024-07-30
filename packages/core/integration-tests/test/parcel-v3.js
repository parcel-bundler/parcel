// @flow

import assert from 'assert';
import {join} from 'path';

import {ParcelV3, toFileSystemV3} from '@parcel/core';
import {NodePackageManager} from '@parcel/package-manager';
import {bundle, fsFixture, inputFS, overlayFS, run} from '@parcel/test-utils';

describe('parcel-v3', function () {
  // Duplicated temporarily for convenience, will remove once the Rust stuff works
  it.skip('should produce a basic JS bundle with CommonJS requires', async function () {
    let b = await bundle(join(__dirname, '/integration/commonjs/index.js'), {
      featureFlags: {parcelV3: true},
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
