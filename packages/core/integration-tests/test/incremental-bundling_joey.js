// @flow strict-local
import {bundler, getNextBuildSuccess, overlayFS} from '@parcel/test-utils';
import assert from 'assert';
import path from 'path';
import sinon from 'sinon';
import Bundler from '@parcel/bundler-default';
import {CONFIG} from '@parcel/plugin';
// $FlowFixMe[untyped-import]
import CustomBundler from './integration/incremental-bundling/node_modules/parcel-bundler-test';

describe('incremental bundling', function() {
  // $FlowFixMe[prop-missing]
  let defaultBundlerSpy = sinon.spy(Bundler[CONFIG], 'bundle');
  let customBundlerSpy = sinon.spy(CustomBundler[CONFIG], 'bundle');

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

  beforeEach(() => {
    defaultBundlerSpy.resetHistory();
    customBundlerSpy.resetHistory();
  });

  after(() => {
    defaultBundlerSpy.restore();
    customBundlerSpy.restore();
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
    it.only('adding a new dependency', async () => {
      let subscription;
      let fixture = path.join(__dirname, '/integration/incremental-bundling');
      try {
        let b = bundler(path.join(fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
        });

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        let event = await getNextBuildSuccess(b);
        assertTimesBundled(defaultBundlerSpy.callCount, 1);

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
  });

  describe('other changes that would for a re-bundle', () => {
    it('changing the bundler in parcel configs', async () => {
      let subscription;
      let fixture = path.join(__dirname, '/integration/incremental-bundling');
      try {
        let b = bundler(path.join(fixture, 'index.js'), {
          inputFS: overlayFS,
          shouldDisableCache: false,
        });

        await overlayFS.mkdirp(fixture);
        subscription = await b.watch();

        let event = await getNextBuildSuccess(b);
        assertTimesBundled(defaultBundlerSpy.callCount, 1);
        assertTimesBundled(customBundlerSpy.callCount, 0);

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
        assertTimesBundled(customBundlerSpy.callCount, 1);

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
});
