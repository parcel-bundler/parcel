// @flow strict-local
import {bundler, getNextBuild, inputFS, overlayFS} from '@parcel/test-utils';
import invariant from 'assert';
import assert from 'assert';
import path from 'path';

import type {PackagedBundle} from '@parcel/types';

// Where I am struggling...  I need a way to store the amount of times the bundler has run; and to check that value.
// What I have here almost worked, uses a fake bundler under this packages node modules and stores the number of time an asset was bundled.
// Perhaps we could output the number of times into a temporary file and check that?

function allAssetsBundledTimes(
  bundles: PackagedBundle[],
  expectedNumberOfTimesBundled: number,
) {
  bundles.forEach(b =>
    b.traverseAssets(asset => {
      // run times are merged after the bundler
      if (
        !asset.filePath.match(/runtimes/) &&
        asset.meta.timesBundled != null
      ) {
        let numberOfTimesBundledEqual =
          asset.meta.timesBundled === expectedNumberOfTimesBundled;
        assert(
          numberOfTimesBundledEqual,
          `the asset should have only been bundled ${expectedNumberOfTimesBundled} time(s)}`,
        );
      }
    }),
  );
}

describe.only('incremental bundling', function() {
  before(async () => {
    await inputFS.rimraf(path.join(__dirname, 'input'));
  });

  // beforeEach(() => {
  //   inputDir = path.join(
  //     __dirname,
  //     '/input',
  //     Math.random()
  //       .toString(36)
  //       .slice(2),
  //   );
  // });

  describe('non-dependency based changes', () => {
    describe('javascript', () => {
      it.only('add a console log should not bundle', async () => {
        this.timeout(15000);
        let subscription;

        let fixture = path.join(__dirname, '/integration/incremental-bundling');
        try {
          let b = bundler(path.join(fixture, 'index.js'), {
            inputFS: overlayFS,
            shouldDisableCache: false,
          });
          await overlayFS.mkdirp(fixture);
          subscription = await b.watch();

          let event = await getNextBuild(b);
          invariant(event.type === 'buildSuccess');
          let beforeBundles = event.bundleGraph.getBundles();
          allAssetsBundledTimes(beforeBundles, 1);

          await overlayFS.writeFile(
            path.join(fixture, 'index.js'),
            `
const a = import('./a');

console.log('index.js');
console.log('adding a new console');
          `,
          );

          event = await getNextBuild(b);
          invariant(event.type === 'buildSuccess');

          let afterBundles = event.bundleGraph.getBundles();
          allAssetsBundledTimes(afterBundles, 1);
          assert.equal(event.changedAssets.size, 1);
        } finally {
          if (subscription) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
      });

      it.only('updating a string value should not bundle', async () => {
        this.timeout(15000);
        let subscription;

        let fixture = path.join(__dirname, '/integration/incremental-bundling');
        try {
          let b = bundler(path.join(fixture, 'index.js'), {
            inputFS: overlayFS,
            shouldDisableCache: false,
          });
          await overlayFS.mkdirp(fixture);
          subscription = await b.watch();

          let event = await getNextBuild(b);
          invariant(event.type === 'buildSuccess');
          let beforeBundles = event.bundleGraph.getBundles();
          allAssetsBundledTimes(beforeBundles, 1);

          await overlayFS.writeFile(
            path.join(fixture, 'index.js'),
            `
const a = import('./a');

console.log('index.js - updated string');
          `,
          );

          event = await getNextBuild(b);
          invariant(event.type === 'buildSuccess');

          let afterBundles = event.bundleGraph.getBundles();
          allAssetsBundledTimes(afterBundles, 1);
          assert.equal(event.changedAssets.size, 1);
        } finally {
          if (subscription) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
      });
      it('adding a comment');
    });

    describe('non-javascript', () => {
      it('updating css');
      it('updating sass');
    });
  });

  describe('dependency based changes should run the bundler', () => {
    it('adding a new dependency');
    it('removing a dependency');
    it('updating to remove a symbol');
  });

  describe('other changes that would for a re-bundle', () => {
    it('changing the bundler in parcel configs');
    it('changing bundler options');
  });
});
