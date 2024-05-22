// @flow
import assert from 'assert';
import path from 'path';
import {
  overlayFS,
  bundle,
  fsFixture,
  getParcelOptions,
} from '@parcel/test-utils';
import {loadGraphs} from '../../../dev/query/src';
import resolveOptions from '@parcel/core/src/resolveOptions';
import Parcel from '@parcel/core';

describe('parcel-query', () => {
  it('loadGraphs', async function () {
    let entries = 'index.js';
    let options = {
      mode: 'production',
      defaultTargetOptions: {
        shouldScopeHoist: false,
      },
      shouldDisableCache: false,
      inputFS: overlayFS,
      cacheDir: path.join(__dirname, '.parcel-cache'),
    };

    await fsFixture(overlayFS)`
        index.js:
            export default 1;`;

    const initialOptions = getParcelOptions(entries, options);
    const {cache} = await resolveOptions(initialOptions);
    const parcel = new Parcel(initialOptions);
    await parcel.run();

    const {assetGraph, bundleGraph, requestTracker, bundleInfo} =
      await loadGraphs(options.cacheDir, cache);

    assert(bundleInfo, 'Could not load bundleInfo');
    assert(bundleGraph, 'Could not load bundleGraph');
    assert(assetGraph, 'Could not load assetGraph');
    assert(requestTracker, 'Count not load requestTracker');
  });
});
