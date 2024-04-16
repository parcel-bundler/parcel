// @flow strict-local
import assert from 'assert';
import path from 'path';
import {createWorkerFarm} from '@parcel/core';
import {MemoryFS} from '@parcel/fs';
import {distDir, bundle, inputFS} from '@parcel/test-utils';

describe('tracing', function () {
  let workerFarm = createWorkerFarm({
    shouldTrace: true,
  });

  let outputFS = new MemoryFS(workerFarm);

  for (let mode of ['development', 'production']) {
    it(`should produce a ${mode} trace`, async function () {
      await bundle(
        path.join(__dirname, '/integration/typescript-jsx/index.tsx'),
        {
          additionalReporters: [
            {
              packageName: '@parcel/reporter-tracer',
              resolveFrom: __dirname,
            },
          ],
          inputFS,
          mode,
          outputFS,
          shouldTrace: true,
          targets: {
            default: {distDir},
          },
          workerFarm,
        },
      );

      const files = outputFS.readdirSync(__dirname);
      const profileFile = files.find(file => file.startsWith('parcel-trace'));
      assert(profileFile !== null);
      const content = await outputFS.readFile(
        path.join(__dirname, profileFile),
        'utf8',
      );
      const profileContent = JSON.parse(content + ']'); // Traces don't contain a closing ] as an optimisation for partial writes
      assert(profileContent.length > 0);
    });
  }
});
