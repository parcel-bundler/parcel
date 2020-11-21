// @flow
import type {InitialParcelOptions, BuildSuccessEvent} from '@parcel/types';
import assert from 'assert';
import path from 'path';
import {
  assertBundles,
  bundler,
  run,
  overlayFS,
  inputFS,
  ncp,
} from '@parcel/test-utils';

function runBundle(entries = 'src/index.js', opts) {
  entries = (Array.isArray(entries) ? entries : [entries]).map(entry =>
    path.join(__dirname, 'input', entry),
  );

  return bundler(entries, {
    ...opts,
    inputFS: overlayFS,
    disableCache: false,
  }).run();
}

type UpdateFn = BuildSuccessEvent =>
  | ?InitialParcelOptions
  | Promise<?InitialParcelOptions>;
type TestConfig = {|
  ...InitialParcelOptions,
  entries?: Array<string>,
  setup?: () => void | Promise<void>,
  update: UpdateFn,
|};

async function testCache(update: UpdateFn | TestConfig, integration) {
  // Delete cache from previous test and perform initial build
  await inputFS.rimraf(path.join(__dirname, '/input'));
  await overlayFS.rimraf(path.join(__dirname, '/input'));
  await ncp(
    path.join(__dirname, '/integration', integration ?? 'cache'),
    path.join(__dirname, '/input'),
  );
  await overlayFS.rimraf(path.join(__dirname, '/input/.parcel-cache'));
  await overlayFS.rimraf(path.join(__dirname, '/input/dist'));

  let entries;
  let options: ?InitialParcelOptions;
  if (typeof update === 'object') {
    let setup;
    ({entries, setup, update, ...options} = update);

    if (setup) {
      await setup();
    }
  }

  let b = await runBundle(entries, options);

  // update
  let newOptions = await update(b);

  // Run cached build
  b = await runBundle(entries, Object.assign({}, options, newOptions));

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
    // $FlowFixMe
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
    // $FlowFixMe
    await assert.rejects(async () => {
      await testCache(async () => {
        await overlayFS.unlink(
          path.join(__dirname, '/input/src/nested/test.js'),
        );
      });
    });

    // Do a third build from a failed state with no changes
    // $FlowFixMe
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
      // $FlowFixMe
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
    it('should support adding an entry that matches a glob', async function() {
      let b = await testCache({
        entries: ['src/entries/*.js'],
        async update(b) {
          assertBundles(b.bundleGraph, [
            {
              name: 'a.js',
              assets: ['a.js'],
            },
            {
              name: 'b.js',
              assets: ['b.js'],
            },
          ]);

          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/entries/c.js'),
            'export let c = "c";',
          );
        },
      });

      assertBundles(b.bundleGraph, [
        {
          name: 'a.js',
          assets: ['a.js'],
        },
        {
          name: 'b.js',
          assets: ['b.js'],
        },
        {
          name: 'c.js',
          assets: ['c.js'],
        },
      ]);
    });

    it('should support deleting an entry that matches a glob', async function() {
      let b = await testCache({
        entries: ['src/entries/*.js'],
        async update(b) {
          assertBundles(b.bundleGraph, [
            {
              name: 'a.js',
              assets: ['a.js'],
            },
            {
              name: 'b.js',
              assets: ['b.js'],
            },
          ]);

          await overlayFS.unlink(
            path.join(__dirname, '/input/src/entries/b.js'),
          );
        },
      });

      assertBundles(b.bundleGraph, [
        {
          name: 'a.js',
          assets: ['a.js'],
        },
      ]);
    });

    it('should error when deleting a file entry', async function() {
      // $FlowFixMe
      await assert.rejects(
        async () => {
          await testCache(async () => {
            await overlayFS.unlink(path.join(__dirname, '/input/src/index.js'));
          });
        },
        {
          message: `Entry ${path.join(
            __dirname,
            'input/src/index.js',
          )} does not exist`,
        },
      );
    });

    it('should recover from errors when adding a missing entry', async function() {
      // $FlowFixMe
      await assert.rejects(
        async () => {
          await testCache(async () => {
            await overlayFS.unlink(path.join(__dirname, '/input/src/index.js'));
          });
        },
        {
          message: `Entry ${path.join(
            __dirname,
            'input/src/index.js',
          )} does not exist`,
        },
      );

      await overlayFS.writeFile(
        path.join(__dirname, '/input/src/index.js'),
        'module.exports = "hi"',
      );

      let b = await runBundle();
      assert.equal(await run(b.bundleGraph), 'hi');
    });
  });

  describe('target config', function() {
    it('should support adding a target config', async function() {
      let b = await testCache({
        scopeHoist: true,
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            !contents.includes('export default'),
            'should not include export default',
          );

          let pkgFile = path.join(__dirname, '/input/package.json');
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                esmodule: {
                  outputFormat: 'esmodule',
                },
              },
            }),
          );
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        contents.includes('export default'),
        'should include export default',
      );
    });

    it('should support adding a second target', async function() {
      let pkgFile = path.join(__dirname, '/input/package.json');
      let b = await testCache({
        scopeHoist: true,
        async setup() {
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  engines: {
                    browsers: 'last 1 Chrome version',
                  },
                },
              },
            }),
          );
        },
        async update(b) {
          assertBundles(b.bundleGraph, [
            {
              name: 'index.js',
              assets: ['index.js', 'test.js'],
            },
          ]);

          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  engines: {
                    browsers: 'last 1 Chrome version',
                  },
                },
                legacy: {
                  engines: {
                    browsers: 'IE 11',
                  },
                },
              },
            }),
          );
        },
      });

      assertBundles(b.bundleGraph, [
        {
          name: 'index.js',
          assets: ['index.js', 'test.js'],
        },
        {
          name: 'index.js',
          assets: ['index.js', 'test.js'],
        },
      ]);
    });

    it('should support changing target output location', async function() {
      let pkgFile = path.join(__dirname, '/input/package.json');
      await testCache({
        scopeHoist: true,
        async setup() {
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              modern: 'modern/index.js',
              legacy: 'legacy/index.js',
              targets: {
                modern: {
                  engines: {
                    browsers: 'last 1 Chrome version',
                  },
                },
                legacy: {
                  engines: {
                    browsers: 'IE 11',
                  },
                },
              },
            }),
          );
        },
        async update() {
          assert(
            await overlayFS.exists(
              path.join(__dirname, '/input/modern/index.js'),
            ),
          );
          assert(
            await overlayFS.exists(
              path.join(__dirname, '/input/legacy/index.js'),
            ),
          );

          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              modern: 'dist/modern/index.js',
              legacy: 'dist/legacy/index.js',
              targets: {
                modern: {
                  engines: {
                    browsers: 'last 1 Chrome version',
                  },
                },
                legacy: {
                  engines: {
                    browsers: 'IE 11',
                  },
                },
              },
            }),
          );
        },
      });

      assert(
        await overlayFS.exists(
          path.join(__dirname, '/input/dist/modern/index.js'),
        ),
      );
      assert(
        await overlayFS.exists(
          path.join(__dirname, '/input/dist/legacy/index.js'),
        ),
      );
    });

    it('should support updating target config options', async function() {
      let pkgFile = path.join(__dirname, '/input/package.json');
      let b = await testCache({
        scopeHoist: true,
        async setup() {
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                esmodule: {
                  outputFormat: 'esmodule',
                },
              },
            }),
          );
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            contents.includes('export default'),
            'should include export default',
          );

          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                esmodule: {
                  outputFormat: 'commonjs',
                },
              },
            }),
          );
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        contents.includes('module.exports ='),
        'should include module.exports =',
      );
    });

    it('should support deleting a target', async function() {
      let pkgFile = path.join(__dirname, '/input/package.json');
      let b = await testCache({
        scopeHoist: true,
        async setup() {
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  engines: {
                    browsers: 'last 1 Chrome version',
                  },
                },
                legacy: {
                  engines: {
                    browsers: 'IE 11',
                  },
                },
              },
            }),
          );
        },
        async update(b) {
          assertBundles(b.bundleGraph, [
            {
              name: 'index.js',
              assets: ['index.js', 'test.js'],
            },
            {
              name: 'index.js',
              assets: ['index.js', 'test.js'],
            },
          ]);

          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  engines: {
                    browsers: 'last 1 Chrome version',
                  },
                },
              },
            }),
          );
        },
      });

      assertBundles(b.bundleGraph, [
        {
          name: 'index.js',
          assets: ['index.js', 'test.js'],
        },
      ]);
    });

    it('should support deleting all targets', async function() {
      let pkgFile = path.join(__dirname, '/input/package.json');
      let b = await testCache({
        scopeHoist: true,
        async setup() {
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  outputFormat: 'esmodule',
                },
                legacy: {
                  outputFormat: 'commonjs',
                },
              },
            }),
          );
        },
        async update(b) {
          assertBundles(b.bundleGraph, [
            {
              name: 'index.js',
              assets: ['index.js', 'test.js'],
            },
            {
              name: 'index.js',
              assets: ['index.js', 'test.js'],
            },
          ]);

          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            contents.includes('export default'),
            'should include export default',
          );

          contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[1].filePath,
            'utf8',
          );
          assert(
            contents.includes('module.exports ='),
            'should include module.exports',
          );

          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: undefined,
            }),
          );
        },
      });

      assertBundles(b.bundleGraph, [
        {
          name: 'index.js',
          assets: ['index.js', 'test.js'],
        },
      ]);

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        !contents.includes('export default'),
        'should not include export default',
      );
      assert(
        !contents.includes('module.exports ='),
        'should not include module.exports',
      );
    });

    it('should update when sourcemap options change', async function() {
      let pkgFile = path.join(__dirname, '/input/package.json');
      let b = await testCache({
        scopeHoist: true,
        async setup() {
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  sourceMap: true,
                },
              },
            }),
          );
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            contents.includes('sourceMappingURL=index.js.map'),
            'should include sourceMappingURL',
          );

          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  sourceMap: {
                    inline: true,
                  },
                },
              },
            }),
          );
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        contents.includes('sourceMappingURL=data:application/json'),
        'should include inline sourceMappingURL',
      );
    });

    it('should update when publicUrl changes', async function() {
      let pkgFile = path.join(__dirname, '/input/package.json');
      let b = await testCache({
        entries: ['src/index.html'],
        scopeHoist: true,
        async setup() {
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  publicUrl: 'http://example.com/',
                },
              },
            }),
          );
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            contents.includes('<script src="http://example.com'),
            'should include example.com',
          );

          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  publicUrl: 'http://mygreatwebsite.com/',
                },
              },
            }),
          );
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        contents.includes('<script src="http://mygreatwebsite.com'),
        'should include example.com',
      );
    });

    it('should update when a package.json is created', async function() {
      let pkgFile = path.join(__dirname, '/input/package.json');
      let pkg;
      let b = await testCache({
        scopeHoist: true,
        async setup() {
          pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.unlink(pkgFile);
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            !contents.includes('export default'),
            'does not include export default',
          );

          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  outputFormat: 'esmodule',
                },
              },
            }),
          );
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        contents.includes('export default'),
        'should include export default',
      );
    });

    it('should update when a package.json is deleted', async function() {
      let pkgFile = path.join(__dirname, '/input/package.json');
      let b = await testCache({
        scopeHoist: true,
        async setup() {
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  outputFormat: 'esmodule',
                },
              },
            }),
          );
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            contents.includes('export default'),
            'should include export default',
          );
          await overlayFS.unlink(pkgFile);
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        !contents.includes('export default'),
        'does not include export default',
      );
    });

    describe('browserslist', function() {
      it('should update when a browserslist file is added', async function() {
        let b = await testCache({
          scopeHoist: true,
          async update(b) {
            let contents = await overlayFS.readFile(
              b.bundleGraph.getBundles()[0].filePath,
              'utf8',
            );
            assert(
              /class \$[a-f0-9]+\$var\$Test/.test(contents),
              'should include class',
            );
            await overlayFS.writeFile(
              path.join(__dirname, '/input/browserslist'),
              'IE >= 11',
            );
          },
        });

        let contents = await overlayFS.readFile(
          b.bundleGraph.getBundles()[0].filePath,
          'utf8',
        );
        assert(
          !/class \$[a-f0-9]+\$var\$Test/.test(contents),
          'does not include class',
        );
      });

      it('should update when a .browserslistrc file is added', async function() {
        let b = await testCache({
          scopeHoist: true,
          async update(b) {
            let contents = await overlayFS.readFile(
              b.bundleGraph.getBundles()[0].filePath,
              'utf8',
            );
            assert(
              /class \$[a-f0-9]+\$var\$Test/.test(contents),
              'should include class',
            );
            await overlayFS.writeFile(
              path.join(__dirname, '/input/.browserslistrc'),
              'IE >= 11',
            );
          },
        });

        let contents = await overlayFS.readFile(
          b.bundleGraph.getBundles()[0].filePath,
          'utf8',
        );
        assert(
          !/class \$[a-f0-9]+\$var\$Test/.test(contents),
          'does not include class',
        );
      });

      it('should update when a browserslist is updated', async function() {
        let b = await testCache({
          scopeHoist: true,
          async setup() {
            await overlayFS.writeFile(
              path.join(__dirname, '/input/browserslist'),
              'IE >= 11',
            );
          },
          async update(b) {
            let contents = await overlayFS.readFile(
              b.bundleGraph.getBundles()[0].filePath,
              'utf8',
            );
            assert(
              !/class \$[a-f0-9]+\$var\$Test/.test(contents),
              'does not include class',
            );
            await overlayFS.writeFile(
              path.join(__dirname, '/input/browserslist'),
              'last 1 Chrome version',
            );
          },
        });

        let contents = await overlayFS.readFile(
          b.bundleGraph.getBundles()[0].filePath,
          'utf8',
        );
        assert(
          /class \$[a-f0-9]+\$var\$Test/.test(contents),
          'should include class',
        );
      });

      it('should update when a browserslist is deleted', async function() {
        let b = await testCache({
          scopeHoist: true,
          async setup() {
            await overlayFS.writeFile(
              path.join(__dirname, '/input/browserslist'),
              'IE >= 11',
            );
          },
          async update(b) {
            let contents = await overlayFS.readFile(
              b.bundleGraph.getBundles()[0].filePath,
              'utf8',
            );
            assert(
              !/class \$[a-f0-9]+\$var\$Test/.test(contents),
              'does not include class',
            );
            await overlayFS.unlink(path.join(__dirname, '/input/browserslist'));
          },
        });

        let contents = await overlayFS.readFile(
          b.bundleGraph.getBundles()[0].filePath,
          'utf8',
        );
        assert(
          /class \$[a-f0-9]+\$var\$Test/.test(contents),
          'should include class',
        );
      });

      it('should update when BROWSERSLIST_ENV changes', async function() {
        let b = await testCache({
          scopeHoist: true,
          async setup() {
            await overlayFS.writeFile(
              path.join(__dirname, '/input/browserslist'),
              `
            [production]
            IE >= 11

            [development]
            last 1 Chrome version
            `,
            );
          },
          async update(b) {
            // "production" is the default environment for browserslist
            let contents = await overlayFS.readFile(
              b.bundleGraph.getBundles()[0].filePath,
              'utf8',
            );
            assert(
              !/class \$[a-f0-9]+\$var\$Test/.test(contents),
              'does not include class',
            );

            process.env.BROWSERSLIST_ENV = 'development';
          },
        });

        let contents = await overlayFS.readFile(
          b.bundleGraph.getBundles()[0].filePath,
          'utf8',
        );
        assert(
          /class \$[a-f0-9]+\$var\$Test/.test(contents),
          'should include class',
        );

        delete process.env.BROWSERSLIST_ENV;
      });

      it('should update when NODE_ENV changes', async function() {
        let env = process.env.NODE_ENV;
        let b = await testCache({
          scopeHoist: true,
          async setup() {
            await overlayFS.writeFile(
              path.join(__dirname, '/input/browserslist'),
              `
            [production]
            IE >= 11

            [development]
            last 1 Chrome version
            `,
            );
          },
          async update(b) {
            // "production" is the default environment for browserslist
            let contents = await overlayFS.readFile(
              b.bundleGraph.getBundles()[0].filePath,
              'utf8',
            );
            assert(
              !/class \$[a-f0-9]+\$var\$Test/.test(contents),
              'does not include class',
            );

            process.env.NODE_ENV = 'development';
          },
        });

        let contents = await overlayFS.readFile(
          b.bundleGraph.getBundles()[0].filePath,
          'utf8',
        );
        assert(
          /class \$[a-f0-9]+\$var\$Test/.test(contents),
          'should include class',
        );

        process.env.NODE_ENV = env;
      });
    });
  });

  describe('options', function() {
    it('should update when publicUrl changes', async function() {
      let b = await testCache({
        entries: ['src/index.html'],
        scopeHoist: true,
        publicUrl: 'http://example.com/',
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            contents.includes('<script src="http://example.com'),
            'should include example.com',
          );

          return {
            publicUrl: 'http://mygreatwebsite.com/',
          };
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        contents.includes('<script src="http://mygreatwebsite.com'),
        'should include example.com',
      );
    });

    it('should update when minify changes', async function() {
      let b = await testCache({
        scopeHoist: true,
        minify: false,
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(contents.includes('Test'), 'should include Test');

          return {
            minify: true,
          };
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(!contents.includes('Test'), 'should not include Test');
    });

    it('should update when scopeHoist changes', async function() {
      let b = await testCache({
        scopeHoist: false,
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            contents.includes('parcelRequire'),
            'should include parcelRequire',
          );

          return {
            scopeHoist: true,
          };
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(!contents.includes('parcelRequire'), 'should not include Test');
    });

    it('should update when sourceMaps changes', async function() {
      let b = await testCache({
        sourceMaps: false,
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            !contents.includes('sourceMappingURL=index.js.map'),
            'should not include sourceMappingURL',
          );

          return {
            sourceMaps: true,
          };
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        contents.includes('sourceMappingURL=index.js.map'),
        'should include sourceMappingURL',
      );
    });

    it('should update when distDir changes', async function() {
      let b = await testCache({
        scopeHoist: true,
        update(b) {
          assert(
            /dist[/\\]index.js$/.test(b.bundleGraph.getBundles()[0].filePath),
            'should end with dist/index.js',
          );

          return {
            distDir: 'dist/test',
          };
        },
      });

      assert(
        /dist[/\\]test[/\\]index.js$/.test(
          b.bundleGraph.getBundles()[0].filePath,
        ),
        'should end with dist/test/index.js',
      );
    });

    it('should update when targets changes', async function() {
      let b = await testCache({
        scopeHoist: true,
        targets: ['legacy'],
        async setup() {
          let pkgFile = path.join(__dirname, '/input/package.json');
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              targets: {
                modern: {
                  engines: {
                    browsers: 'last 1 Chrome version',
                  },
                },
                legacy: {
                  engines: {
                    browsers: 'IE 11',
                  },
                },
              },
            }),
          );
        },
        async update(b) {
          assertBundles(b.bundleGraph, [
            {
              name: 'index.js',
              assets: ['index.js', 'test.js'],
            },
          ]);

          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            !/class \$[a-f0-9]+\$var\$Test/.test(contents),
            'should not include class',
          );

          return {
            targets: ['modern'],
          };
        },
      });

      assertBundles(b.bundleGraph, [
        {
          name: 'index.js',
          assets: ['index.js', 'test.js'],
        },
      ]);

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        /class \$[a-f0-9]+\$var\$Test/.test(contents),
        'should include class',
      );
    });

    it('should update when defaultEngines changes', async function() {
      let b = await testCache({
        scopeHoist: true,
        defaultEngines: {
          browsers: 'last 1 Chrome version',
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            /class \$[a-f0-9]+\$var\$Test/.test(contents),
            'should include class',
          );

          return {
            defaultEngines: {
              browsers: 'IE 11',
            },
          };
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        !/class \$[a-f0-9]+\$var\$Test/.test(contents),
        'should not include class',
      );
    });

    it('should update when contentHash changes', async function() {
      let b = await testCache({
        entries: ['src/index.html'],
        scopeHoist: true,
        contentHash: true,
        update(b) {
          let bundle = b.bundleGraph.getBundles()[1];
          assert(!bundle.name.includes(bundle.id.slice(-8)));

          return {
            contentHash: false,
          };
        },
      });

      let bundle = b.bundleGraph.getBundles()[1];
      assert(bundle.name.includes(bundle.id.slice(-8)));
    });

    it('should update when hot options change', async function() {
      let b = await testCache({
        hot: {
          host: 'localhost',
          port: 4321,
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            contents.includes('HMR_HOST = "localhost"'),
            'should include HMR_HOST = "localhost"',
          );
          assert(
            contents.includes('HMR_PORT = 4321'),
            'should include HMR_PORT = 4321',
          );

          return {
            hot: {
              host: 'example.com',
              port: 5678,
            },
          };
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        contents.includes('HMR_HOST = "example.com"'),
        'should include HMR_HOST = "example.com"',
      );
      assert(
        contents.includes('HMR_PORT = 5678'),
        'should include HMR_PORT = 5678',
      );
    });

    it('should invalidate react refresh hot options change', async function() {
      let b = await testCache({
        async setup() {
          let pkgFile = path.join(__dirname, '/input/package.json');
          let pkg = JSON.parse(await overlayFS.readFile(pkgFile));
          await overlayFS.writeFile(
            pkgFile,
            JSON.stringify({
              ...pkg,
              dependencies: {
                react: '*',
              },
            }),
          );

          await overlayFS.writeFile(
            path.join(__dirname, '/input/src/index.js'),
            `import React from 'react';
            
            export function Component() {
              return <h1>Hello world</h1>;
            }`,
          );
        },
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(
            !contents.includes('getRefreshBoundarySignature'),
            'should not include getRefreshBoundarySignature',
          );

          return {
            hot: {
              host: 'example.com',
              port: 5678,
            },
          };
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(
        contents.includes('getRefreshBoundarySignature'),
        'should include getRefreshBoundarySignature',
      );
    });

    it('should update when the config option changes', async function() {
      let b = await testCache({
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(!contents.includes('TRANSFORMED CODE'));

          await overlayFS.writeFile(
            path.join(__dirname, '/input/some-config'),
            JSON.stringify({
              extends: '@parcel/config-default',
              transformers: {
                '*.js': ['parcel-transformer-mock'],
              },
            }),
          );

          return {
            config: path.join(__dirname, '/input/some-config'),
          };
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(contents.includes('TRANSFORMED CODE'));
    });

    it('should update when the defaultConfig option changes', async function() {
      let b = await testCache({
        async update(b) {
          let contents = await overlayFS.readFile(
            b.bundleGraph.getBundles()[0].filePath,
            'utf8',
          );
          assert(!contents.includes('TRANSFORMED CODE'));

          await overlayFS.writeFile(
            path.join(__dirname, '/input/some-config'),
            JSON.stringify({
              extends: '@parcel/config-default',
              transformers: {
                '*.js': ['parcel-transformer-mock'],
              },
            }),
          );

          return {
            defaultConfig: path.join(__dirname, '/input/some-config'),
          };
        },
      });

      let contents = await overlayFS.readFile(
        b.bundleGraph.getBundles()[0].filePath,
        'utf8',
      );
      assert(contents.includes('TRANSFORMED CODE'));
    });
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
