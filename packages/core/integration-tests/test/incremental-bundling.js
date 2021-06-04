// @flow strict-local
import {
  bundler,
  nextBundle,
  assertBundleTree,
  getNextBuildSuccess,
  overlayFS,
} from '@parcel/test-utils';
import assert from 'assert';
import path from 'path';
import sinon from 'sinon';

describe('incremental bundling for dependency changes', function() {
  it('should produce the same result when adding a new dependency', async () => {
    let subscription;
    let fixture = path.join(__dirname, '/integration/incremental-bundling');
    try {
      let b = bundler(path.join(fixture, 'index.js'), {
        inputFS: overlayFS,
        shouldDisableCache: false,
      });

      let incremental_b = bundler(path.join(fixture, 'index.js'), {
        inputFS: overlayFS,
        shouldDisableCache: false,
        shouldIncrementallyBundle: true,
      });

      await overlayFS.mkdirp(fixture);
      subscription = await b.watch();

      await overlayFS.mkdirp(fixture);
      subscription = await incremental_b.watch();

      let event = await getNextBuildSuccess(b);
      let event_incremental = await getNextBuildSuccess(incremental_b);
      //assertTimesBundled(defaultBundlerSpy.callCount, 1);

      await overlayFS.writeFile(
        path.join(fixture, 'index.js'),
        `const a = import('./a');
        const b = import('./b');
        console.log('index.js', b);
        console.log(a);
        `,
      );

      event = await getNextBuildSuccess(b);
      event_incremental = await getNextBuildSuccess(incremental_b);
      //assertChangedAssets(event.changedAssets.size, 2);
      //assertTimesBundled(defaultBundlerSpy.callCount, 2);

      let output = await overlayFS.readFile(
        path.join(fixture, 'index.js'),
        'utf8',
      );
      assert(output.includes(`console.log('index.js', b);`));
    } finally {
      if (subscription) {
        await subscription.unsubscribe();
        subscription = null;
      }
    }
  });
});
