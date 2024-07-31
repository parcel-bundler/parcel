// @flow

import assert from 'assert';
import {join} from 'path';

import {ParcelV3, toFileSystemV3} from '@parcel/core';
import {NodePackageManager} from '@parcel/package-manager';
import {bundle, fsFixture, inputFS, overlayFS, run} from '@parcel/test-utils';

describe('parcel-v3', function () {
  describe('ParcelV3', () => {
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

  describe('using a rust asset graph', () => {
    it('builds commonjs', async () => {
      await fsFixture(overlayFS, __dirname)`
        index.js:
          var local = require('./main');

          module.exports = function () {
            return local.a + local.b;
          };

        main.js:
          exports.a = 1;
          exports.b = 2;

        .parcelrc:
          {
            "extends": "@parcel/config-default",
            "transformers": {
              "*.{js,mjs,jsm,jsx,es6,cjs,ts,tsx}": ["@parcel/transformer-js"]
            }
          }

        yarn.lock: {}
      `;

      let b = await bundle(join(__dirname, 'index.js'), {
        featureFlags: {
          parcelV3: true,
        },
        inputFS: overlayFS,
      });

      let output = await run(b);
      assert.equal(typeof output, 'function');
      assert.equal(output(), 3);
    });
  });
});
