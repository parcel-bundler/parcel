// @flow strict-local
import path from 'path';
import assert from 'assert';
import {
  assertBundles,
  bundle,
  describe,
  distDir,
  fsFixture,
  it,
  outputFS,
  overlayFS,
} from '@atlaspack/test-utils';

import {ATLASPACK_VERSION} from '../../core/src/constants';

describe.v2('JS API', function () {
  it('should respect distEntry', async function () {
    const NAME = 'custom-name.js';

    let b = await bundle(
      path.join(__dirname, '/integration/js-comment/index.js'),
      {
        targets: {
          default: {distDir, distEntry: NAME},
        },
      },
    );

    assertBundles(b, [
      {
        name: NAME,
        type: 'js',
        assets: ['index.js'],
      },
    ]);

    assert(await outputFS.exists(path.join(distDir, NAME)));
  });

  it('should run additional reports from the options', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/js-comment/index.js'),
      {
        additionalReporters: [
          {
            packageName: '@atlaspack/reporter-bundle-buddy',
            resolveFrom: __dirname,
          },
        ],
      },
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.js'],
      },
    ]);

    assert(await outputFS.exists(path.join(distDir, 'bundle-buddy.json')));
  });

  describe('Reporter API', () => {
    it('should pass the atlaspack version to plugins', async () => {
      const dir = path.join(__dirname, 'plugin-atlaspack-version');

      overlayFS.mkdirp(dir);

      await fsFixture(overlayFS, dir)`
      index.js:
        export default 'Hi';

      .atlaspackrc:
        {
          extends: "@atlaspack/config-default",
          reporters: ["./reporter-plugin.js", "..."],
        }

      package.json:
        {
          "version": "1234"
        }

      yarn.lock:

      reporter-plugin.js:
        import {Reporter} from '@atlaspack/plugin';
        import path from 'node:path';

        export default new Reporter({
          async report({event, options}) {
            if (event.type === 'buildSuccess') {
              await options.outputFS.writeFile(path.join(options.projectRoot, 'atlaspack-version.txt'), options.atlaspackVersion);
            }
          }
        })
      `;

      await bundle(path.join(dir, 'index.js'), {
        inputFS: overlayFS,
        outputFS: overlayFS,
      });

      assert.equal(
        await overlayFS.readFile(path.join(dir, 'atlaspack-version.txt')),
        ATLASPACK_VERSION,
      );
    });
  });
});
