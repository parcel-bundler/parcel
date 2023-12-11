// @flow
import assert from 'assert';
import path from 'path';
import {
  overlayFS,
  getParcelOptions,
  bundle,
  fsFixture,
} from '@parcel/test-utils';
import {NodePackageManager} from '@parcel/package-manager';
import resolveOptions from '@parcel/core/src/resolveOptions';
// import {version} from '@parcel/core/package.json';
// import {deserialize} from '@parcel/core/src/serializer';
// import {hashString} from '@parcel/rust';

import {run} from '../../../dev/query/src/cli.js';

let resolvedOptions;
// let requestTracker;
// let bundleGraph;
describe('parcel-query', () => {
  before(async () => {
    let overlayFSPackageManager = new NodePackageManager(overlayFS, __dirname);
    let entries = 'source/index.js';
    let options = {
      mode: 'production',
      defaultTargetOptions: {
        shouldScopeHoist: false,
      },
      packageManager: overlayFSPackageManager,
      shouldDisableCache: false,
      inputFS: overlayFS,
      cacheDir: path.join(__dirname, '.parcel-cache'),
    };

    await fsFixture(overlayFS)`
          source
            foo.js:
    
              export default 2;
            index.js:
              import('./foo');
    
              export default 1;
            yarn.lock:`;

    /*bundleGraph =*/ await bundle(entries, options);
    assert(overlayFS.readdirSync(options.cacheDir));

    resolvedOptions = await resolveOptions(getParcelOptions(entries, options));

    // let requestGraphKey = hashString(`${version}:${JSON.stringify(resolvedOptions.entries)}:${resolvedOptions.mode}:requestGraph`);
    // let bundleGraphKey = hashString(`${version}:BundleGraph:${JSON.stringify(resolvedOptions.entries) ?? ''}${resolvedOptions.mode}`);

    // requestTracker = deserialize(await resolvedOptions.cache.getLargeBlob(requestGraphKey));
    // bundleGraph = deserialize(await resolvedOptions.cache.getLargeBlob(bundleGraphKey));

    // assert(requestTracker);
    // assert(bundleGraph);
  });

  it.only('get bundles', async function () {
    run(['getBundles()'], resolvedOptions);
  });
});
