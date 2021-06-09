// @flow strict-local
import {
  bundler,
  getNextBuildSuccess,
  overlayFS,
  removeDistDirectory,
  sleep,
  outputFS,
} from '@parcel/test-utils';
import assert from 'assert';
import path from 'path';
import sinon from 'sinon';
import Bundler from '@parcel/bundler-default';
import {CONFIG} from '@parcel/plugin';

describe('incremental bundling', function() {
  let subscription;
  beforeEach(async function() {
    // TODO maybe don't do this for all tests
    await sleep(100);
    await outputFS.rimraf(inputDir);
    await sleep(100);
  });

  afterEach(async () => {
    await removeDistDirectory();
    if (subscription) {
      await subscription.unsubscribe();
      subscription = null;
    }
  });
  let assertChangedAssets = (actual: number, expected: number) => {
    assert.equal(
      actual,
      expected,
      `the number of changed assets should be ${expected}, not ${actual}`,
    );
  };

  let assertTimesBundled = (actual: number, expected: number) => {
    assert.equal(
      actual,
      expected,
      `the bundler should have bundled ${expected} time(s), not ${actual}`,
    );
  };
  describe('dependency based changes', async () => {
    it('should produce the same outcome as a traditional rebundle on adding a dependency', async () => {
      let subscription;
      let inc_sunscription;
      let fixture = path.join(
        __dirname,
        '/integration/base/incremental-bundling',
      );
      let inc_fixture = path.join(
        __dirname,
        '/integration/nonbase/incremental-bundling',
      );
      try {
        let b = bundler(path.join(fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
        });

        let inc_b = bundler(path.join(inc_fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
          shouldIncrementallyBundle: true,
        });

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        await overlayFS.mkdirp(inc_fixture);
        inc_sunscription = await inc_b.watch();

        let event = await getNextBuildSuccess(b);
        let inc_event = await getNextBuildSuccess(inc_b);
        //assertTimesBundled(defaultBundlerSpy.callCount, 1);
        //can assset here that both had bundle be called
        await overlayFS.writeFile(
          path.join(fixture, 'index.js'),
          `const a = import('./a');
        const b = import('./b');
        console.log('index.js', b);
        console.log(a);
        `,
        );

        await overlayFS.writeFile(
          path.join(inc_fixture, 'index.js'),
          `const a = import('./a');
        const b = import('./b');
        console.log('index.js', b);
        console.log(a);
        `,
        );

        event = await getNextBuildSuccess(b);
        inc_event = await getNextBuildSuccess(inc_b);
        assertChangedAssets(event.changedAssets.size, 2);
        assertChangedAssets(inc_event.changedAssets.size, 2);
        //assertTimesBundled(defaultBundlerSpy.callCount, 2);

        let output = await overlayFS.readFile(
          path.join(fixture, 'index.js'),
          'utf8',
        );
        //no
        assert(output.includes(`console.log('index.js', b);`));
      } finally {
        if (subscription) {
          await subscription.unsubscribe();
          subscription = null;
        }
        if (inc_sunscription) {
          await inc_sunscription.unsubscribe();
          inc_sunscription = null;
        }
      }
    });
  });
});

it('should update bundle on added dependency', async function() {});
