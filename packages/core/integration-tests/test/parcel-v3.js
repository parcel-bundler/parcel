// @flow

import assert from 'assert';
import path from 'path';
import {promisify} from 'util';
import {bundle, run} from '@parcel/test-utils';
import {inputFS} from '@parcel/test-utils';
import {ParcelV3} from '@parcel/core';

describe('parcel-v3', function () {
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

  it('should run the main-thread bootstrap function', async function () {
    let fs: any = {
      readFileSync: promisify(inputFS.readFile),
      isFile: async (...args) =>
        (await promisify(inputFS.stat)(...args)).isFile(),
      isDir: (...args) => inputFS.statSync(...args).isDirectory(),
    };

    let parcel = new ParcelV3({
      fs,
      nodeWorkers: 1,
    });

    assert(
      typeof (await parcel._internal.testingTempFsReadToString(__filename)) ===
        'string',
    );
    assert(!(await parcel._internal.testingTempFsIsDir(__filename)));
    assert(await parcel._internal.testingTempFsIsFile(__filename));
    await parcel._internal.testingRpcPing();

    await parcel.build({});
  });
});
