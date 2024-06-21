import assert from 'assert';
import path from 'path';

import {bundle, fsFixture, overlayFS, run} from '@parcel/test-utils';
import sinon from 'sinon';

describe('globals', function () {
  it('should support global alias syntax', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/global-alias/index.js'),
    );

    assert.equal(
      await run(b, {
        React: {
          createElement: function () {
            return 'ok';
          },
        },
      }),
      'ok',
    );
  });

  describe('supports global in imported modules', () => {
    const dir = path.join(__dirname, 'global-var');

    beforeEach(async () => {
      await overlayFS.mkdirp(dir);
      await fsFixture(overlayFS, dir)`
        index.js:
          import { main } from './main';

          onGlobal(main());

        main.js:
          export function main() {
            let _global = typeof global !== 'undefined' ? global : 'missing global';

            return _global;
          }

        yarn.lock: {}
      `;
    });

    afterEach(async () => {
      await overlayFS.rimraf(dir);
    });

    it('when scope hoisting is disabled', async function () {
      let bundleGraph = await bundle(path.join(dir, 'index.js'), {
        defaultTargetOptions: {
          context: 'browser',
          shouldScopeHoist: false,
        },
        inputFS: overlayFS,
      });

      let bundles = await Promise.all(
        bundleGraph
          .getBundles()
          .map(b => overlayFS.readFile(b.filePath, 'utf8')),
      );

      let onGlobal = sinon.spy();
      await run(bundleGraph, {globalThis: 'global', onGlobal});

      assert(bundles.some(b => b.includes('var global = arguments[3]')));
      assert(
        bundles.every(b => !b.includes('var $parcel$global = globalThis')),
      );
      assert.equal(onGlobal.callCount, 1);
      assert.deepEqual(onGlobal.firstCall.args, ['global']);
    });

    it('when scope hoisting is enabled', async function () {
      let bundleGraph = await bundle(path.join(dir, 'index.js'), {
        defaultTargetOptions: {
          context: 'browser',
          shouldScopeHoist: true,
        },
        inputFS: overlayFS,
      });

      let bundles = await Promise.all(
        bundleGraph
          .getBundles()
          .map(b => overlayFS.readFile(b.filePath, 'utf8')),
      );

      let onGlobal = sinon.spy();
      await run(bundleGraph, {globalThis: 'global', onGlobal});

      assert(bundles.some(b => b.includes('var $parcel$global = globalThis')));
      assert(bundles.every(b => !b.includes('var global = arguments[3]')));
      assert.equal(onGlobal.callCount, 1);
      assert.deepEqual(onGlobal.firstCall.args, ['global']);
    });
  });
});
