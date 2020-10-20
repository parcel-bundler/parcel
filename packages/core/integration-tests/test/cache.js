import assert from 'assert';
import path from 'path';
import {bundler, run, overlayFS, ncp} from '@parcel/test-utils';

function runBundle() {
  return bundler(path.join(__dirname, '/input/src/index.js'), {
    inputFS: overlayFS,
    disableCache: false,
  }).run();
}

async function testCache(update, integration) {
  // Delete cache from previous test and perform initial build
  await overlayFS.rimraf(path.join(__dirname, '/input'));
  await ncp(
    path.join(__dirname, '/integration', integration ?? 'cache'),
    path.join(__dirname, '/input'),
  );
  await overlayFS.rimraf(path.join(__dirname, '/input/.parcel-cache'));
  await overlayFS.rimraf(path.join(__dirname, '/input/dist'));

  if (typeof update === 'object') {
    await update.setup();
    update = update.update;
  }

  let b = await runBundle();

  // update
  await update(b);

  // Run cached build
  b = await runBundle();

  return b;
}

describe('cache', function() {
  it('should support updating a JS file', async function() {
    let b = await testCache(async b => {
      assert.equal(await run(b.bundleGraph), 4);
      await overlayFS.writeFile(
        path.join(__dirname, '/input/src/nested/test.js'),
        'export default 4',
      );
    });

    assert.equal(await run(b.bundleGraph), 6);
  });

  it('should support adding a dependency', async function() {
    let b = await testCache(async b => {
      assert.equal(await run(b.bundleGraph), 4);
      await overlayFS.writeFile(
        path.join(__dirname, '/input/src/nested/foo.js'),
        'export default 6',
      );
      await overlayFS.writeFile(
        path.join(__dirname, '/input/src/nested/test.js'),
        'export {default} from "./foo";',
      );
    });

    assert.equal(await run(b.bundleGraph), 8);
  });

  it('should error when deleting a file', async function() {
    await assert.rejects(
      async () => {
        await testCache(async () => {
          await overlayFS.unlink(
            path.join(__dirname, '/input/src/nested/test.js'),
          );
        });
      },
      {message: "Failed to resolve './nested/test' from './src/index.js'"},
    );
  });

  it('should error when starting parcel from a broken state with no changes', async function() {
    await assert.rejects(async () => {
      await testCache(async () => {
        await overlayFS.unlink(
          path.join(__dirname, '/input/src/nested/test.js'),
        );
      });
    });

    // Do a third build from a failed state with no changes
    await assert.rejects(
      async () => {
        await runBundle();
      },
      {message: "Failed to resolve './nested/test' from './src/index.js'"},
    );
  });

  describe('babel', function() {
    it('should support adding a .babelrc', function() {});

    it('should support updating a .babelrc', function() {});

    it('should support updating an extended .babelrc', function() {});

    it('should support adding a nested .babelrc', function() {});

    it('should support updating a nested .babelrc', function() {});

    it('should support deleting a nested .babelrc', function() {});

    it('should support deleting a custom .babelrc', function() {});
  });

  describe('parcel config', function() {
    it('should support adding a .parcelrc', async function() {
      let b = await testCache(async b => {
        assert.equal(await run(b.bundleGraph), 4);

        let contents = await overlayFS.readFile(
          b.bundleGraph.getBundles()[0].filePath,
          'utf8',
        );
        assert(!contents.includes('TRANSFORMED CODE'));

        await overlayFS.writeFile(
          path.join(__dirname, '/input/.parcelrc'),
          JSON.stringify({
            extends: '@parcel/config-default',
            transformers: {
              '*.js': ['parcel-transformer-mock'],
            },
          }),
        );
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(contents.includes('TRANSFORMED CODE'));
    });

    it('should support updating a .parcelrc', async function() {
      let b = await testCache({
        async setup() {
          await overlayFS.writeFile(
            path.join(__dirname, '/input/.parcelrc'),
            JSON.stringify({
              extends: '@parcel/config-default',
              transformers: {
                '*.js': ['parcel-transformer-mock'],
              },
            }),
          );
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(contents.includes('TRANSFORMED CODE'));

          await overlayFS.writeFile(
            path.join(__dirname, '/input/.parcelrc'),
            JSON.stringify({
              extends: '@parcel/config-default',
            }),
          );
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(!contents.includes('TRANSFORMED CODE'));

      assert.equal(await run(b.bundleGraph), 4);
    });

    it('should support updating an extended .parcelrc', async function() {
      let b = await testCache({
        async setup() {
          await overlayFS.writeFile(
            path.join(__dirname, '/input/.parcelrc-extended'),
            JSON.stringify({
              extends: '@parcel/config-default',
              transformers: {
                '*.js': ['parcel-transformer-mock'],
              },
            }),
          );

          await overlayFS.writeFile(
            path.join(__dirname, '/input/.parcelrc'),
            JSON.stringify({
              extends: './.parcelrc-extended',
            }),
          );
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(contents.includes('TRANSFORMED CODE'));

          await overlayFS.writeFile(
            path.join(__dirname, '/input/.parcelrc-extended'),
            JSON.stringify({
              extends: '@parcel/config-default',
            }),
          );
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(!contents.includes('TRANSFORMED CODE'));

      assert.equal(await run(b.bundleGraph), 4);
    });

    it('should error when deleting an extended parcelrc', async function() {
      await assert.rejects(
        async () => {
          await testCache({
            async setup() {
              await overlayFS.writeFile(
                path.join(__dirname, '/input/.parcelrc-extended'),
                JSON.stringify({
                  extends: '@parcel/config-default',
                  transformers: {
                    '*.js': ['parcel-transformer-mock'],
                  },
                }),
              );

              await overlayFS.writeFile(
                path.join(__dirname, '/input/.parcelrc'),
                JSON.stringify({
                  extends: './.parcelrc-extended',
                }),
              );
            },
            async update(b) {
              let contents = await overlayFS.readFile(
                b.bundleGraph.getBundles()[0].filePath,
                'utf8',
              );
              assert(contents.includes('TRANSFORMED CODE'));

              await overlayFS.unlink(
                path.join(__dirname, '/input/.parcelrc-extended'),
              );
            },
          });
        },
        {message: 'Cannot find extended parcel config'},
      );
    });

    it('should support deleting a .parcelrc', async function() {
      let b = await testCache({
        async setup() {
          await overlayFS.writeFile(
            path.join(__dirname, '/input/.parcelrc'),
            JSON.stringify({
              extends: '@parcel/config-default',
              transformers: {
                '*.js': ['parcel-transformer-mock'],
              },
            }),
          );
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(contents.includes('TRANSFORMED CODE'));

          await overlayFS.unlink(path.join(__dirname, '/input/.parcelrc'));
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(!contents.includes('TRANSFORMED CODE'));

      assert.equal(await run(b.bundleGraph), 4);
    });
  });

  describe('transformations', function() {
    it('should invalidate when included files changes', async function() {
      let b = await testCache({
        async setup() {
          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/test.txt'),
            'hi',
          );

          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/index.js'),
            'module.exports = require("fs").readFileSync(__dirname + "/test.txt", "utf8")',
          );
        },
        async update(b) {
          assert.equal(await run(b.bundleGraph), 'hi');

          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/test.txt'),
            'updated',
          );
        },
      });

      assert.equal(await run(b.bundleGraph), 'updated');
    });

    it('should not invalidate when a set environment variable does not change', async () => {
      let b = await testCache({
        async setup() {
          await overlayFS.writeFile(
            path.join(__dirname, '/input/.env'),
            'TEST=hi',
          );

          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/index.js'),
            'module.exports = process.env.TEST',
          );
        },
        async update(b) {
          assert.equal(await run(b.bundleGraph), 'hi');

          await overlayFS.writeFile(
            path.join(__dirname, '/input/.env'),
            'TEST=hi',
          );
        },
      });

      assert.equal(await run(b.bundleGraph), 'hi');
      assert.equal(b.changedAssets.size, 0);
    });

    it('should not invalidate when an environment variable remains unset', async () => {
      let b = await testCache({
        async setup() {
          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/index.js'),
            'module.exports = process.env.TEST',
          );
        },
        async update(b) {
          assert.equal(await run(b.bundleGraph), undefined);
        },
      });

      assert.equal(await run(b.bundleGraph), undefined);
      assert.equal(b.changedAssets.size, 0);
    });

    it('should invalidate when an environment variable becomes set', async () => {
      let b = await testCache({
        async setup() {
          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/index.js'),
            'module.exports = process.env.TEST',
          );
        },
        async update(b) {
          assert.equal(await run(b.bundleGraph), undefined);
          await overlayFS.writeFile(
            path.join(__dirname, '/input/.env'),
            'TEST=hi',
          );
        },
      });

      assert.equal(await run(b.bundleGraph), 'hi');
    });

    it('should invalidate when an environment variable becomes unset', async () => {
      let b = await testCache({
        async setup() {
          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/index.js'),
            'module.exports = process.env.TEST',
          );
          await overlayFS.writeFile(
            path.join(__dirname, '/input/.env'),
            'TEST=hi',
          );
        },
        async update(b) {
          assert.equal(await run(b.bundleGraph), 'hi');
          await overlayFS.writeFile(path.join(__dirname, '/input/.env'), '');
        },
      });

      assert.equal(await run(b.bundleGraph), undefined);
    });

    it('should invalidate when environment variables change', async function() {
      let b = await testCache({
        async setup() {
          await overlayFS.writeFile(
            path.join(__dirname, '/input/.env'),
            'TEST=hi',
          );

          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/index.js'),
            'module.exports = process.env.TEST',
          );
        },
        async update(b) {
          assert.equal(await run(b.bundleGraph), 'hi');

          await overlayFS.writeFile(
            path.join(__dirname, '/input/.env'),
            'TEST=updated',
          );
        },
      });

      assert.equal(await run(b.bundleGraph), 'updated');
    });
  });

  describe('entries', function() {
    it('should support adding an entry that matches a glob', function() {});

    it('should support deleting an entry that matches a glob', function() {});

    it('should error when deleting a file entry', function() {});

    it('should recover from errors when adding a missing entry', function() {});
  });

  describe('target config', function() {
    it('should support adding a target config', function() {});

    it('should support adding a second target', function() {});

    it('should support changing target output location', function() {});

    it('should support updating target config options', function() {});

    it('should support deleting a target', function() {});

    it('should support deleting all targets', function() {});
  });

  describe('resolver', function() {
    it('should support updating a package.json#main field', function() {});

    it('should support adding an alias', function() {});

    it('should support updating an alias', function() {});

    it('should support deleting an alias', function() {});

    it('should support adding a node_modules folder', function() {});

    it('should support adding a package.json', function() {});

    it('should support updating a symlink', function() {});
  });

  describe('bundler config', function() {
    it('should support adding bundler config', function() {});

    it('should support updating bundler config', function() {});

    it('should support removing bundler config', function() {});
  });

  describe('scope hoisting', function() {
    it('should support adding sideEffects config', function() {});

    it('should support updating sideEffects config', function() {});

    it('should support removing sideEffects config', function() {});
  });

  describe('runtime', () => {
    it('should support updating files added by runtimes', async function() {
      let b = await testCache(async b => {
        let contents = await overlayFS.readFile(
          b.bundleGraph.getBundles()[0].filePath,
          'utf8',
        );
        assert(contents.includes('INITIAL CODE'));
        await overlayFS.writeFile(
          path.join(__dirname, 'input/dynamic-runtime.js'),
          "module.exports = 'UPDATED CODE'",
        );
      }, 'runtime-update');

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(contents.includes('UPDATED CODE'));
    });
  });
});
