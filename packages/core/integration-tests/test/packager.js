import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {normalizePath} from '@parcel/utils';
import {createWorkerFarm} from '@parcel/core';
import {md} from '@parcel/diagnostic';
import {
  assertBundles,
  bundle as _bundle,
  bundler as _bundler,
  distDir,
  findAsset,
  findDependency,
  getNextBuild,
  mergeParcelOptions,
  outputFS,
  overlayFS,
  run,
  runBundle,
} from '@parcel/test-utils';

const runBundler = (name, opts = {}) => {
  return _bundle(
    name,
    // $FlowFixMe
    mergeParcelOptions({}, opts),
  );
};

const bundler = (name, opts = {}) => {
  return _bundler(
    name,
    // $FlowFixMe
    mergeParcelOptions({}, opts),
  );
};

describe.only('packager', function () {
  describe('globalThis polyfill', function () {
    describe('es6', function () {
      it('should include globalThis polyfill in ie11 builds', async function () {
        const entryPoint = path.join(
          __dirname,
          'integration/html-js-dynamic/index.html',
        );
        const options = {
          defaultTargetOptions: {
            shouldOptimize: true,
            engines: {
              browsers: 'last 2 Chrome version',
              node: '18',
            },
          },
        };
        const bundleGraph = await runBundler(entryPoint, options);

        for (const b of bundleGraph.getBundles()) {
          let code = await overlayFS.readFile(nullthrows(b.filePath), 'utf8');
          console.log(b.name);
          console.log(code);
          console.log();
          console.log();
        }
      });
    });
  });

  // describe('commonjs', function () {
  //   it('supports require of commonjs modules', async function () {
  //     let b = await bundle(
  //       path.join(
  //         __dirname,
  //         '/integration/scope-hoisting/commonjs/require/a.js',
  //       ),
  //     );

  //     let output = await run(b);
  //     assert.equal(output, 2);
  //   });
  // });
});
