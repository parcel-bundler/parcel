// @flow

import {join} from 'path';

import {ParcelV3, toFileSystemV3} from '@parcel/core';
import {NodePackageManager} from '@parcel/package-manager';
import {describe, fsFixture, inputFS, it, overlayFS} from '@parcel/test-utils';

describe('ParcelV3', function () {
  it('builds', async () => {
    await fsFixture(overlayFS, __dirname)`
      index.js:
        console.log('hello world');

      .parcelrc:
        {
          "extends": "@parcel/config-default",
          "transformers": {
            "*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}": ["@parcel/transformer-js"]
          }
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
