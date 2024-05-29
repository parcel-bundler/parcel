import assert from 'assert';
import path from 'path';
import url from 'url';
import {
  assertDependencyWasExcluded,
  bundle,
  bundler,
  findAsset,
  findDependency,
  getNextBuild,
  run,
  runBundle,
  runBundles,
  assertBundles,
  ncp,
  overlayFS,
  removeDistDirectory,
  distDir,
  outputFS,
  inputFS,
  fsFixture,
} from '@parcel/test-utils';
import {makeDeferredWithPromise, normalizePath} from '@parcel/utils';
import vm from 'vm';
import * as napi from '@parcel/rust';
import Logger from '@parcel/logger';
import nullthrows from 'nullthrows';
import {md} from '@parcel/diagnostic';

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
    napi.mainBootstrap(console.log);
  });
});
