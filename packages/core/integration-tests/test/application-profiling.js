// @flow strict-local
import assert from 'assert';
import path from 'path';
import {distDir, bundle, outputFS} from '@parcel/test-utils';

describe('application profiling', function () {
  it('should produce an application profile', async function () {
    await bundle(
      path.join(__dirname, '/integration/typescript-jsx/index.tsx'),
      {
        shouldProfileApplication: true,
        targets: {
          default: {distDir},
        },
        additionalReporters: [
          {
            packageName: '@parcel/reporter-application-profiler',
            resolveFrom: __dirname,
          },
        ],
        outputFS,
      },
    );

    const files = outputFS.readdirSync(__dirname);
    const profileFile = files.find(file =>
      file.startsWith('parcel-application-profile'),
    );
    assert(profileFile !== null);
    const content = await outputFS.readFile(
      path.join(__dirname, profileFile),
      'utf8',
    );
    const profileContent = JSON.parse(content + ']'); // Traces don't contain a closing ] as an optimisation for partial writes
    assert(profileContent.length > 0);
  });
});
