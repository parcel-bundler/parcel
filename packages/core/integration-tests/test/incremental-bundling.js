// @flow strict-local
import {
  bundler,
  getNextBuildSuccess,
  overlayFS,
  bundle,
  assertBundles,
} from '@parcel/test-utils';
import assert from 'assert';
import path from 'path';
import sinon from 'sinon';
import Bundler from '@parcel/bundler-default';
import {CONFIG} from '@parcel/plugin';
//import CustomBundler from './integration/incremental-bundling/node_modules/parcel-bundler-test/index';

// TODO : Determine how to spy on the custom bundler

describe('incremental bundling', function() {
  // $FlowFixMe[prop-missing]
  let defaultBundlerSpy = sinon.spy(Bundler[CONFIG], 'bundle');
  let incrementalBundlerSpy = sinon.spy(Bundler[CONFIG], 'update');
  //let customBundlerSpy = sinon.spy(CustomBundler[CONFIG], 'update');

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

  let assertTimesUpdated = (actual: number, expected: number) => {
    assert.equal(
      actual,
      expected,
      `the bundler should have updated ${expected} time(s), not ${actual}`,
    );
  };

  beforeEach(() => {
    defaultBundlerSpy.resetHistory();
    incrementalBundlerSpy.resetHistory();
    // customBundlerSpy.resetHistory();
  });

  after(() => {
    defaultBundlerSpy.restore();
    incrementalBundlerSpy.resetHistory();
    // customBundlerSpy.restore();
  });

  describe('non-dependency based changes', () => {
    describe('javascript', () => {
      it('add a console log should not bundle', async () => {
        let subscription;
        let fixture = path.join(__dirname, '/integration/incremental-bundling');
        try {
          let b = bundler(path.join(fixture, 'index.js'), {
            inputFS: overlayFS,
            shouldDisableCache: false,
            shouldIncrementallyBundle: true,
          });

          await overlayFS.mkdirp(fixture);
          subscription = await b.watch();

          let event = await getNextBuildSuccess(b);
          assertTimesBundled(defaultBundlerSpy.callCount, 1);

          await overlayFS.writeFile(
            path.join(fixture, 'index.js'),
            `const a = import('./a');

console.log('index.js');
console.log(a);
console.log('adding a new console');`,
          );

          event = await getNextBuildSuccess(b);
          assertChangedAssets(event.changedAssets.size, 1);
          assertTimesBundled(defaultBundlerSpy.callCount, 1);

          let output = await overlayFS.readFile(
            path.join(fixture, 'index.js'),
            'utf8',
          );
          assert(output.includes(`console.log('adding a new console')`));
        } finally {
          if (subscription) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
      });

      it('updating a string value should not bundle', async () => {
        let subscription;
        let fixture = path.join(__dirname, '/integration/incremental-bundling');
        try {
          let b = bundler(path.join(fixture, 'index.js'), {
            inputFS: overlayFS,
            shouldDisableCache: false,
            shouldIncrementallyBundle: true,
          });

          await overlayFS.mkdirp(fixture);
          subscription = await b.watch();

          let event = await getNextBuildSuccess(b);
          assertTimesBundled(defaultBundlerSpy.callCount, 1);

          await overlayFS.writeFile(
            path.join(fixture, 'index.js'),
            `const a = import('./a');

console.log('index.js - updated string');
console.log(a);
`,
          );

          event = await getNextBuildSuccess(b);
          assertChangedAssets(event.changedAssets.size, 1);
          assertTimesBundled(defaultBundlerSpy.callCount, 1);

          let output = await overlayFS.readFile(
            path.join(fixture, 'index.js'),
            'utf8',
          );
          assert(output.includes(`console.log('index.js - updated string');`));
        } finally {
          if (subscription) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
      });

      it('adding a comment', async () => {
        let subscription;
        let fixture = path.join(__dirname, '/integration/incremental-bundling');
        try {
          let b = bundler(path.join(fixture, 'index.js'), {
            inputFS: overlayFS,
            shouldDisableCache: false,
            shouldIncrementallyBundle: true,
          });

          await overlayFS.mkdirp(fixture);
          subscription = await b.watch();

          let event = await getNextBuildSuccess(b);
          assertTimesBundled(defaultBundlerSpy.callCount, 1);

          await overlayFS.writeFile(
            path.join(fixture, 'index.js'),
            `const a = import('./a');
// test comment
console.log('index.js');
console.log(a);`,
          );

          event = await getNextBuildSuccess(b);
          assertChangedAssets(event.changedAssets.size, 1);
          assertTimesBundled(defaultBundlerSpy.callCount, 1);

          let output = await overlayFS.readFile(
            path.join(fixture, 'index.js'),
            'utf8',
          );
          assert(output.includes(`// test comment`));
        } finally {
          if (subscription) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
      });
    });
  });

  describe('dependency based changes should run the bundler', () => {
    // TODO - need to update this test
    it('adding a new dependency', async () => {
      let subscription;
      let fixture = path.join(__dirname, '/integration/incremental-bundling');
      try {
        let b = bundler(path.join(fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
          shouldIncrementallyBundle: false,
        });

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        let event = await getNextBuildSuccess(b);
        assertTimesBundled(defaultBundlerSpy.callCount, 1); //no bundling

        await overlayFS.writeFile(
          path.join(fixture, 'index.js'),
          `const a = import('./a');
const b = import('./b');

console.log('index.js', b);
console.log(a);
`,
        );

        event = await getNextBuildSuccess(b);
        assertChangedAssets(event.changedAssets.size, 2);
        assertTimesBundled(defaultBundlerSpy.callCount, 2);

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

    it('removing a dependency', async () => {
      let subscription;
      let fixture = path.join(__dirname, '/integration/incremental-bundling');
      try {
        let b = bundler(path.join(fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
          shouldIncrementallyBundle: true,
        });

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        let event = await getNextBuildSuccess(b);
        assertTimesBundled(defaultBundlerSpy.callCount, 1);

        await overlayFS.writeFile(
          path.join(fixture, 'index.js'),
          `// const a = import('./a');

console.log('index.js');`,
        );

        event = await getNextBuildSuccess(b);
        assertChangedAssets(event.changedAssets.size, 1);
        assertTimesBundled(defaultBundlerSpy.callCount, 2);

        let output = await overlayFS.readFile(
          path.join(fixture, 'index.js'),
          'utf8',
        );
        assert(output.includes(`// const a = import('./a')`));
      } finally {
        if (subscription) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
    });

    // TODO : Some tests to implement
    it('should update the bundle graph if a dynamic import is added');
    it('should update the bundle graph if a new type of file is added (css)');
  });

  describe('other changes that would for a re-bundle', () => {
    it('changing the bundler in parcel configs', async () => {
      let subscription;
      let fixture = path.join(__dirname, '/integration/incremental-bundling');
      try {
        let b = bundler(path.join(fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
          shouldIncrementallyBundle: true,
        });

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        let event = await getNextBuildSuccess(b);
        assertTimesBundled(defaultBundlerSpy.callCount, 1);
        // assertTimesBundled(customBundlerSpy.callCount, 0);

        await overlayFS.writeFile(
          path.join(fixture, '.parcelrc'),
          JSON.stringify({
            extends: '@parcel/config-default',
            bundler: 'parcel-bundler-test',
          }),
        );

        event = await getNextBuildSuccess(b);

        // should contain all the assets
        assertChangedAssets(event.changedAssets.size, 3);
        // the default bundler was only called once
        assertTimesBundled(defaultBundlerSpy.callCount, 1);
        // calls the new bundler to rebundle
        // assertTimesBundled(customBundlerSpy.callCount, 1);

        let output = await overlayFS.readFile(
          path.join(fixture, 'index.js'),
          'utf8',
        );
        assert(output.includes(`const a = import('./a')`));
      } finally {
        if (subscription) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
    });

    it('changing bundler options', async () => {
      let subscription;
      let fixture = path.join(__dirname, '/integration/incremental-bundling');
      try {
        let b = bundler(path.join(fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
          shouldIncrementallyBundle: true,
        });

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        let event = await getNextBuildSuccess(b);
        assertTimesBundled(defaultBundlerSpy.callCount, 1);

        let pkgFile = path.join(fixture, 'package.json');
        let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
        await overlayFS.writeFile(
          pkgFile,
          JSON.stringify({
            ...pkg,
            '@parcel/bundler-default': {
              http: 1,
            },
          }),
        );

        event = await getNextBuildSuccess(b);

        // should contain all the assets
        assertChangedAssets(event.changedAssets.size, 3);
        assertTimesBundled(defaultBundlerSpy.callCount, 2);

        let output = await overlayFS.readFile(
          path.join(fixture, 'index.js'),
          'utf8',
        );
        assert(output.includes(`const a = import('./a')`));
      } finally {
        if (subscription) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
    });
  });

  describe('incremental bundling for dependency changes', function() {
    // TODO - need to update this test
    it('should update, not bundle, when adding a new dependency after save', async () => {
      let subscription;
      let fixture = path.join(__dirname, '/integration/incremental-bundling');
      try {
        let b = bundler(path.join(fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
          shouldIncrementallyBundle: true,
        });

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        let event = await getNextBuildSuccess(b);
        assertTimesBundled(defaultBundlerSpy.callCount, 1); //no bundling

        await overlayFS.writeFile(
          path.join(fixture, 'index.js'),
          `const a = import('./a');
const b = import('./b');

console.log('index.js', b);
console.log(a);
`,
        );

        event = await getNextBuildSuccess(b);
        assertChangedAssets(event.changedAssets.size, 2);
        assertTimesBundled(defaultBundlerSpy.callCount, 1);
        assertTimesUpdated(incrementalBundlerSpy.callCount, 1);

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

    it('should update when removing a dependency', async () => {
      let subscription;
      let fixture = path.join(__dirname, '/integration/incremental-bundling');
      try {
        let b = bundler(path.join(fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
          shouldIncrementallyBundle: true,
        });

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        let event = await getNextBuildSuccess(b);
        assertTimesBundled(defaultBundlerSpy.callCount, 1);

        await overlayFS.writeFile(
          path.join(fixture, 'index.js'),
          `// const a = import('./a');

console.log('index.js');`,
        );

        event = await getNextBuildSuccess(b);
        assertChangedAssets(event.changedAssets.size, 1);
        assertTimesBundled(defaultBundlerSpy.callCount, 1);
        assertTimesUpdated(incrementalBundlerSpy.callCount, 1);
        let output = await overlayFS.readFile(
          path.join(fixture, 'index.js'),
          'utf8',
        );
        assert(output.includes(`// const a = import('./a')`));
      } finally {
        if (subscription) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
    });

    it(
      'on update, it should remove a dependency from an asset, but not remove that asset if it is used elsewhere',
    );
    it('should update after a combination of adds and saves');
    it.skip('should produce the same graph and bundle result when adding a new dependency', async () => {
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
        }); //should be using custom plugin ? and with a different file system probably

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        await overlayFS.mkdirp(fixture);
        subscription = await incremental_b.watch();

        // let event = await getNextBuildSuccess(b);
        // let event_incremental = await getNextBuildSuccess(incremental_b);
        // assertTimesBundled(defaultBundlerSpy.callCount, 1);

        await overlayFS.writeFile(
          path.join(fixture, 'index.js'),
          `const a = import('./a');
        const b = import('./b');
        console.log('index.js', b);
        console.log(a);
        `,
        );

        // event = await getNextBuildSuccess(b);
        // event_incremental = await getNextBuildSuccess(incremental_b);
        // assertChangedAssets(event.changedAssets.size, 2);
        // assertTimesBundled(defaultBundlerSpy.callCount, 2);

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
});
