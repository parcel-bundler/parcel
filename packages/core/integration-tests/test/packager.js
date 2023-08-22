import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {
  bundle as _bundle,
  mergeParcelOptions,
  overlayFS,
} from '@parcel/test-utils';

const runBundler = (name, opts = {}) => {
  return _bundle(
    name,
    // $FlowFixMe
    mergeParcelOptions({}, opts),
  );
};

function hasPolyfill(code) {
  const noPolyfill = `var $parcel$global = globalThis;`;
  const polyfill = `typeof globalThis !== 'undefined'`;
  return code.includes(polyfill) && !code.includes(noPolyfill);
}

describe('packager', function () {
  describe('globalThis polyfill', function () {
    it('should exclude globalThis polyfill in modern builds', async function () {
      const entryPoint = path.join(
        __dirname,
        'integration/html-js-dynamic/index.html',
      );
      const options = {
        mode: 'production',
        defaultTargetOptions: {
          shouldOptimize: false,
          engines: {
            browsers: 'last 2 Chrome version',
          },
        },
      };
      const bundleGraph = await runBundler(entryPoint, options);

      for (const b of bundleGraph.getBundles()) {
        if (b.type !== 'js') continue;
        let code = await overlayFS.readFile(nullthrows(b.filePath), 'utf8');
        assert.ok(!hasPolyfill(code));
      }
    });

    it('should include globalThis polyfill in ie11 builds', async function () {
      const entryPoint = path.join(
        __dirname,
        'integration/packager-global-this/index.html',
      );
      const options = {
        mode: 'production',
        defaultTargetOptions: {
          shouldOptimize: false,
          engines: {
            browsers: 'ie 11',
          },
        },
      };

      const bundleGraph = await runBundler(entryPoint, options);

      for (const b of bundleGraph.getBundles()) {
        if (b.type !== 'js') continue;
        let code = await overlayFS.readFile(nullthrows(b.filePath), 'utf8');
        assert.ok(hasPolyfill(code));
      }
    });

    it('should exclude globalThis polyfill in node builds', async function () {
      const entryPoint = path.join(
        __dirname,
        'integration/packager-global-this/index.js',
      );
      const options = {
        mode: 'production',
        defaultTargetOptions: {
          shouldOptimize: false,
          engines: {
            browsers: 'node 18',
          },
        },
      };

      const bundleGraph = await runBundler(entryPoint, options);

      for (const b of bundleGraph.getBundles()) {
        if (b.type !== 'js') continue;
        let code = await overlayFS.readFile(nullthrows(b.filePath), 'utf8');
        assert.ok(!hasPolyfill(code));
      }
    });
  });
});
