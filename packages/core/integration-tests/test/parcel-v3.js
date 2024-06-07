// @flow

import assert from 'assert';
import path from 'path';
import {bundle, run} from '@parcel/test-utils';
import * as napi from '@parcel/rust';
import {inputFS} from '@parcel/test-utils';

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
    let p = new napi.ParcelNapi({
      fs: {
        readFileSync: (_, [...args]) => inputFS.readFileSync(...args),
        isFile: (_, path) => inputFS.statSync(path).isFile(),
        isDir: (_, path) => inputFS.statSync(path).isDirectory(),
      },
      // eslint-disable-next-line no-unused-vars
      rpc: rpc_wrapper((id, data) => {
        return undefined;
      }),
    });

    assert(typeof (await p.testingTempFsReadToString(__filename)) === 'string');
    assert(!(await p.testingTempFsIsDir(__filename)));
    assert(await p.testingTempFsIsFile(__filename));
    assert.doesNotThrow(async () => {
      await p.testingRpcPing();
    });
  });
});

// shim for Rpc types
const rpc_wrapper =
  (callback: (id: number, data: any) => any | Promise<any>) =>
  async (
    err: any,
    id: number,
    data: any,
    done: (value: {|Ok: any|} | {|Err: any|}) => null,
  ) => {
    if (err) {
      done({Err: err});
      return;
    }
    try {
      done({Ok: (await callback(id, data)) ?? undefined});
    } catch (error) {
      done({Err: error});
    }
  };
