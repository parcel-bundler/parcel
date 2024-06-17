// @flow

import assert from 'assert';
import path from 'path';
import {bundle, run} from '@parcel/test-utils';
import {inputFS, outputFS} from '@parcel/test-utils';
import {ParcelV3} from '@parcel/core';
import {FSCache} from '@parcel/cache';

const cache: FSCache = new FSCache(outputFS, 'some-dir');

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
      readFileSync: (_, [...args]) => inputFS.readFileSync(...args),
      isFile: (_, path) => inputFS.statSync(path).isFile(),
      isDir: (_, path) => inputFS.statSync(path).isDirectory(),
    };

    let parcel = new ParcelV3({
      fs,
      cache,
      nodeWorkers: 1,
    });

    assert(
      typeof (await parcel._internal.testingTempFsReadToString(__filename)) ===
        'string',
    );
    assert(!(await parcel._internal.testingTempFsIsDir(__filename)));
    assert(await parcel._internal.testingTempFsIsFile(__filename));
    await parcel._internal.testingRpcPing();

    await parcel.build();
  });
});
