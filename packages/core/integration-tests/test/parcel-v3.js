// @flow

import assert from 'assert';
import path from 'path';
import {bundle, run} from '@parcel/test-utils';
import * as napi from '@parcel/rust';
import {inputFS} from '@parcel/test-utils';

describe.only('parcel-v3', function () {
  // Duplicated temporarily for convenience, will remove once the Rust stuff works
  it.skip('should produce a basic JS bundle with CommonJS requires', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/commonjs/index.js'),
      {
        featureFlags: {parcelV3: true},
      },
    );

    // assert.equal(b.assets.size, 8);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should run the main-thread bootstrap function', function () {
    // eslint-disable-next-line no-unused-vars

    let p = new napi.ParcelNapi({
      fs: {
        readFileSync: (_, path) => inputFS.readFileSync(path),
        isFile: (_, path) => inputFS.statSync(path).isFile(),
        isDir: (_, path) => inputFS.statSync(path).isDirectory(),
      },
    });

    console.log(p.testingTempFsReadToString(__filename));
    console.log(p.testingTempFsIsDir(__filename));
    console.log(p.testingTempFsIsFile(__filename));
  });
});
