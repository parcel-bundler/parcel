import assert from 'assert';
import path from 'path';
import url from 'url';
import {
  bundle,
  bundler,
  run,
  runBundle,
  assertBundles,
  ncp,
  overlayFS,
  removeDistDirectory,
  distDir,
  outputFS,
  inputFS,
} from '@parcel/test-utils';
import {makeDeferredWithPromise} from '@parcel/utils';

describe('javascript', function() {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should produce a basic JS bundle with CommonJS requires', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/commonjs/index.js'),
    );

    // assert.equal(b.assets.size, 8);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should import child bundles using a require call in CommonJS', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/commonjs-bundle-require/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'JSRuntime.js'],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = await run(b);
    assert.strictEqual(typeof output.double, 'function');
    assert.strictEqual(output.double(3), 6);
  });

  it('should support url: imports with CommonJS output', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/commonjs-import-url/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['bundle-url.js', 'index.js', 'JSRuntime.js'],
      },
      {
        type: 'txt',
        assets: ['x.txt'],
      },
    ]);

    let txtBundle = b.getBundles().find(b => b.type === 'txt').name;

    let output = await run(b);
    assert.strictEqual(path.basename(output), txtBundle);
  });

  it('should produce a basic JS bundle with ES6 imports', async function() {
    let b = await bundle(path.join(__dirname, '/integration/es6/index.js'));

    // assert.equal(b.assets.size, 8);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should detect dependencies inserted by a prior transform', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/dependency-prior-transform/index.js'),
    );

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath);

    assert(!contents.includes('import'));
  });

  it('should produce a basic JS bundle with object rest spread support', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/object-rest-spread/object-rest-spread.js',
      ),
    );

    // assert.equal(b.assets.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');

    let res = output.default();
    assert.equal(res.y, 'a');
    assert.deepEqual(res.z, {y: 'a', b: 'b'});
    assert.deepEqual(res.ys, {b: 'b'});
  });

  it('should bundle node_modules for a browser environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require_browser/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js', 'index.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should not bundle node_modules for a node environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js'],
      },
    ]);

    await outputFS.mkdirp(path.join(distDir, 'node_modules/testmodule'));
    await outputFS.writeFile(
      path.join(distDir, 'node_modules/testmodule/index.js'),
      'exports.a = 5;',
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it.skip('should not bundle node_modules on --target=electron', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'electron',
      },
    );

    assertBundles(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js'],
    });

    await outputFS.mkdirp(path.join(distDir, 'node_modules/testmodule'));
    await outputFS.writeFile(
      path.join(distDir, 'node_modules/testmodule/index.js'),
      'exports.a = 5;',
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it('should preserve hashbangs in bundles and preserve executable file mode', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(fixturePath, 'main.js'));

    let mainPath = path.join(fixturePath, 'dist', 'node', 'main.js');
    let main = await outputFS.readFile(mainPath, 'utf8');
    assert.equal(main.lastIndexOf('#!/usr/bin/env node\n'), 0);
    assert.equal(
      (await outputFS.stat(mainPath)).mode,
      (await inputFS.stat(path.join(fixturePath, 'main.js'))).mode,
    );
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should not preserve hashbangs in browser bundles', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(fixturePath, 'main.js'));

    let main = await outputFS.readFile(
      path.join(fixturePath, 'dist', 'browser', 'main.js'),
      'utf8',
    );
    assert(!main.includes('#!/usr/bin/env node\n'));
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should preserve hashbangs in scopehoisted bundles', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(__dirname, '/integration/node_hashbang/main.js'), {
      scopeHoist: true,
    });

    let main = await outputFS.readFile(
      path.join(fixturePath, 'dist', 'node', 'main.js'),
      'utf8',
    );
    assert.equal(main.lastIndexOf('#!/usr/bin/env node\n'), 0);
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should bundle node_modules for a node environment if includeNodeModules is specified', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/include_node_modules/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js', 'index.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should bundle builtins for a browser environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/include_builtins-browser/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['_empty.js', 'browser.js', 'index.js', 'main.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    let [fs, filepath] = output();
    assert.equal(filepath, path.posix.join('app', 'index.js'));
    assert.equal(typeof fs, 'object');
    assert.deepEqual(Object.keys(fs), Object.keys({}));
  });

  it('should not bundle builtins for a node environment if includeNodeModules is specified', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/include_builtins-node/main.js'),
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    let [fs, filepath] = output();
    assert.equal(filepath, path.join('app', 'index.js'));
    assert.equal(typeof fs.readFile, 'function');
  });

  it.skip('should bundle node_modules on --target=electron and --bundle-node-modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'electron',
        bundleNodeModules: true,
      },
    );

    assertBundles(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js', 'index.js'],
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should produce a JS bundle with default exports and no imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/es6-default-only/index.js'),
    );

    // assert.equal(b.assets.size, 1);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should split bundles when a dynamic import is used a browser environment', async function() {
    let b = await bundle(path.join(__dirname, '/integration/dynamic/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-manifest.js',
          'bundle-url.js',
          'relative-path.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
        ],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should split bundles when a dynamic import is used with a node environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-node/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'JSRuntime.js'],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it.skip('should load dynamic bundle when entry is in a subdirectory', async function() {
    let bu = await bundler(
      path.join(
        __dirname,
        '/integration/dynamic-subdirectory/subdirectory/index.js',
      ),
      {
        target: 'browser',
      },
    );
    // Set the rootDir to make sure subdirectory is preserved
    bu.options.rootDir = path.join(
      __dirname,
      '/integration/dynamic-subdirectory',
    );
    let b = await bu.bundle();
    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('Should not run parcel over external modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-external/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
    ]);
  });

  it('should support bundling workers', async function() {
    let b = await bundle(path.join(__dirname, '/integration/workers/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'common.js',
          'worker-client.js',
          'feature.js',
          'get-worker-url.js',
          'bundle-url.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['service-worker.js'],
      },
      {
        assets: ['shared-worker.js'],
      },
      {
        assets: ['worker.js', 'common.js'],
      },
    ]);
  });

  it('should support bundling workers of type module', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers-module/index.js'),
      {scopeHoist: true},
    );

    assertBundles(b, [
      {
        assets: ['dedicated-worker.js'],
      },
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'get-worker-url.js',
          'bundle-manifest.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['shared-worker.js'],
      },
    ]);

    let dedicated, shared;
    b.traverseBundles((bundle, ctx, traversal) => {
      if (bundle.getMainEntry().filePath.endsWith('shared-worker.js')) {
        shared = bundle;
      } else if (
        bundle.getMainEntry().filePath.endsWith('dedicated-worker.js')
      ) {
        dedicated = bundle;
      }
      if (dedicated && shared) traversal.stop();
    });

    assert(dedicated);
    assert(shared);

    dedicated = await outputFS.readFile(dedicated.filePath, 'utf8');
    shared = await outputFS.readFile(shared.filePath, 'utf8');
    assert(/import .* from ?"foo";/.test(dedicated));
    assert(/import .* from ?"foo";/.test(shared));
  });

  it('should support bundling workers with different order', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers/index-alternative.js'),
    );

    assertBundles(b, [
      {
        name: 'index-alternative.js',
        assets: [
          'index-alternative.js',
          'common.js',
          'worker-client.js',
          'feature.js',
          'bundle-url.js',
          'get-worker-url.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['service-worker.js'],
      },
      {
        assets: ['shared-worker.js'],
      },
      {
        assets: ['worker.js', 'common.js'],
      },
    ]);
  });

  for (let workerType of ['webworker', 'serviceworker']) {
    it(`should split bundles when ${workerType}s use importScripts`, async function() {
      let b = await bundle(
        path.join(
          __dirname,
          `/integration/worker-import-scripts/index-${workerType}.js`,
        ),
      );

      assertBundles(b, [
        {
          assets: [
            'importScripts.js',
            'bundle-url.js',
            'JSRuntime.js',
            'JSRuntime.js',
            'bundle-manifest.js',
            'JSRuntime.js',
            'relative-path.js',
          ],
        },
        {
          name: `index-${workerType}.js`,
          assets: [
            `index-${workerType}.js`,
            'bundle-url.js',
            'JSRuntime.js',
            'bundle-manifest.js',
            'JSRuntime.js',
            'relative-path.js',
          ].concat(workerType === 'webworker' ? ['get-worker-url.js'] : []),
        },
        {
          assets: ['imported.js'],
        },
        {
          assets: ['imported2.js'],
        },
      ]);

      let workerBundleFile = path.join(
        distDir,
        (await outputFS.readdir(distDir)).find(file =>
          file.startsWith('importScripts'),
        ),
      );
      let workerBundleContents = await outputFS.readFile(
        workerBundleFile,
        'utf8',
      );

      assert(
        workerBundleContents.includes(
          'importScripts(require("imported.js"));\n',
        ),
      );
      assert(
        workerBundleContents.includes(
          'importScripts(require("imported.js"), require("imported2.js"));\n',
        ),
      );
    });
  }

  it('should not create bundles of external scripts referenced by importScripts', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/worker-import-scripts/index-external.js',
      ),
    );

    assertBundles(b, [
      {
        name: 'index-external.js',
        assets: [
          'index-external.js',
          'bundle-url.js',
          'get-worker-url.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {assets: ['external.js', 'JSRuntime.js']},
    ]);

    let workerBundleFile = path.join(
      distDir,
      (await outputFS.readdir(distDir)).find(file =>
        file.startsWith('external'),
      ),
    );
    let workerBundleContents = await outputFS.readFile(
      workerBundleFile,
      'utf8',
    );

    assert(
      workerBundleContents.includes(
        'importScripts(require("https://unpkg.com/parcel"));',
      ),
    );
    assert(
      workerBundleContents.includes(
        'module.exports = "https://unpkg.com/parcel";',
      ),
    );
  });

  it('should support bundling service-workers', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/service-worker/a/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'index.js',
          'bundle-url.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['worker-nested.js'],
      },
      {
        assets: ['worker-outside.js'],
      },
    ]);
  });

  it('should support bundling workers with circular dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-circular/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'JSRuntime.js',
          'get-worker-url.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['worker.js', 'worker-dep.js'],
      },
    ]);
  });

  it.skip('should support bundling in workers with other loaders', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers-with-other-loaders/index.js'),
    );

    assertBundles(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'worker-client.js',
        'cacheLoader.js',
        'js-loader.js',
        'wasm-loader.js',
      ],
      childBundles: [
        {
          type: 'wasm',
          assets: ['add.wasm'],
          childBundles: [],
        },
        {
          type: 'map',
        },
        {
          assets: ['worker.js', 'cacheLoader.js', 'wasm-loader.js'],
          childBundles: [
            {
              type: 'map',
            },
          ],
        },
      ],
    });
  });

  it('should create a shared bundle to deduplicate assets in workers', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-shared/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'lodash.js',
          'bundle-url.js',
          'get-worker-url.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'relative-path.js',
        ],
      },
      {
        assets: [
          'worker-a.js',
          'JSRuntime.js',
          'bundle-url.js',
          'get-worker-url.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['worker-b.js'],
      },
      {
        assets: ['lodash.js'],
      },
    ]);

    let sharedBundle = b
      .getBundles()
      .sort((a, b) => b.stats.size - a.stats.size)
      .find(b => b.name !== 'index.js');
    let workerBundle = b.getBundles().find(b => b.name.startsWith('worker-b'));
    let contents = await outputFS.readFile(workerBundle.filePath, 'utf8');
    assert(contents.includes(`importScripts("./${sharedBundle.name}")`));
  });

  it('should create a shared bundle between browser and worker contexts', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/html-shared-worker/index.html'),
    );

    assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        assets: [
          'index.js',
          'bundle-url.js',
          'JSRuntime.js',
          'get-worker-url.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['worker.js'],
      },
      {
        assets: ['lodash.js'],
      },
    ]);

    let sharedBundle = b
      .getBundles()
      .sort((a, b) => b.stats.size - a.stats.size)
      .find(b => b.name !== 'index.js');
    let workerBundle = b.getBundles().find(b => b.name.startsWith('worker'));
    let contents = await outputFS.readFile(workerBundle.filePath, 'utf8');
    assert(contents.includes(`importScripts("./${sharedBundle.name}")`));

    let outputArgs = [];
    let workerArgs = [];
    await run(b, {
      Worker: class {
        constructor(url) {
          workerArgs.push(url);
        }
      },
      output: (ctx, val) => {
        outputArgs.push([ctx, val]);
      },
    });

    assert.deepStrictEqual(outputArgs, [['main', 3]]);
    assert.deepStrictEqual(workerArgs, [
      `http://localhost/${path.basename(workerBundle.filePath)}`,
    ]);
  });

  it('should dynamic import files which import raw files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-references-raw/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['local.js', 'JSRuntime.js'],
      },
      {
        assets: ['test.txt'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should return all exports as an object when using ES modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-esm/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['local.js'],
      },
    ]);

    let output = (await run(b)).default;
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should duplicate small modules across multiple bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-common-small/index.js'),
    );

    assertBundles(b, [
      {
        assets: ['a.js', 'common.js', 'common-dep.js'],
      },
      {
        assets: ['b.js', 'common.js', 'common-dep.js'],
      },
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should create a separate bundle for large modules shared between bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-common-large/index.js'),
    );

    assertBundles(b, [
      {
        assets: ['a.js'],
      },
      {
        assets: ['b.js'],
      },
      {
        name: 'index.js',
        assets: [
          'index.js',
          'c.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['common.js', 'lodash.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should not duplicate a module which is already in a parent bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-hoist-dup/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'common.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['a.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 5);
  });

  it('should duplicate a module if it is not present in every parent bundle', async function() {
    let b = await bundle(
      ['a.js', 'b.js'].map(entry =>
        path.join(__dirname, 'integration/dynamic-hoist-no-dedupe', entry),
      ),
    );
    assertBundles(b, [
      {
        assets: ['c.js', 'common.js'],
      },
      {
        name: 'b.js',
        assets: [
          'b.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        name: 'a.js',
        assets: [
          'a.js',
          'bundle-url.js',
          'common.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
    ]);
  });

  it('should support shared modules with async imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-hoist-deep/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['a.js', 'c.js', 'JSRuntime.js'],
      },
      {
        assets: ['b.js', 'c.js', 'JSRuntime.js'],
      },
      {
        assets: ['1.js'],
      },
    ]);

    let {default: promise} = await run(b);
    assert.ok(await promise);
  });

  it('should support requiring JSON files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.json'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring JSON5 files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json5/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.json5'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support importing a URL to a raw asset', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-raw/index.js'),
      {disableCache: false},
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output()));
    let stats = await outputFS.stat(
      path.join(distDir, url.parse(output()).pathname),
    );
    assert.equal(stats.size, 9);
  });

  it('should support importing a URL to a large raw asset', async function() {
    // 6 megabytes, which exceeds the threshold in summarizeRequest for buffering
    // entire contents into memory and should stream content instead
    let assetSizeBytes = 6000000;

    let distDir = path.join(outputFS.cwd(), '/dist');
    let fixtureDir = path.join(__dirname, '/integration/import-raw');
    let inputDir = path.join(__dirname, 'input');

    await ncp(fixtureDir, inputDir);
    await outputFS.writeFile(
      path.join(inputDir, 'test.txt'),
      Buffer.alloc(assetSizeBytes),
    );

    let b = await bundle(path.join(inputDir, 'index.js'), {
      inputFS: overlayFS,
      distDir,
    });
    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'JSRuntime.js',
          'bundle-url.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        type: 'txt',
        assets: ['test.txt'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(/^http:\/\/localhost\/test\.[0-9a-f]+\.txt$/.test(output()));
    let stats = await outputFS.stat(
      path.join(distDir, url.parse(output()).pathname),
    );
    assert.equal(stats.size, assetSizeBytes);
  });

  it('should minify JS in production mode', async function() {
    let b = await bundle(path.join(__dirname, '/integration/uglify/index.js'), {
      minify: true,
      scopeHoist: false,
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('local.a'));
  });

  it('should use uglify config', async function() {
    await bundle(path.join(__dirname, '/integration/uglify-config/index.js'), {
      minify: true,
      scopeHoist: false,
    });

    let js = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!js.includes('console.log'));
    assert(!js.includes('// This is a comment'));
  });

  it('should insert global variables when needed', async function() {
    let b = await bundle(path.join(__dirname, '/integration/globals/index.js'));

    let output = await run(b);
    assert.deepEqual(output(), {
      dir: path.join(__dirname, '/integration/globals'),
      file: path.join(__dirname, '/integration/globals/index.js'),
      buf: Buffer.from('browser').toString('base64'),
      global: true,
    });
  });

  it('should not insert global variables when used in a module specifier', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/globals-module-specifier/a.js'),
    );

    assertBundles(b, [
      {
        assets: ['a.js', 'b.js', 'c.js'],
      },
    ]);

    let output = await run(b);
    assert.deepEqual(output, 1234);
  });

  it('should not insert global variables in dead branches', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/globals-unused/a.js'),
    );

    assertBundles(b, [
      {
        assets: ['a.js'],
      },
    ]);

    let output = await run(b);
    assert.deepEqual(output, 'foo');
  });

  it('should handle re-declaration of the global constant', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-redeclare/index.js'),
    );

    let output = await run(b);
    assert.deepEqual(output(), false);
  });

  it('should insert environment variables inserted by a prior transform', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/env-prior-transform/index.js'),
    );

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath);

    assert(!contents.includes('process.env'));
    assert.equal(await run(b), 42);
  });

  it('should not insert environment variables in node environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-node/index.js'),
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.env') > -1);
    assert.equal(output(), 'test:test');
  });

  it('should not insert environment variables in electron-main environment', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      targets: {
        main: {
          context: 'electron-main',
          distDir: path.join(__dirname, '/integration/env/dist.js'),
        },
      },
    });

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.env') > -1);
    assert.equal(output(), 'test:test');
  });

  it('should not insert environment variables in electron-renderer environment', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      targets: {
        main: {
          context: 'electron-renderer',
          distDir: path.join(__dirname, '/integration/env/dist.js'),
        },
      },
    });

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.env') > -1);
    assert.equal(output(), 'test:test');
  });

  it('should insert environment variables in browser environment', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'));

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.env') === -1);
    assert.equal(output(), 'test:test');
  });

  it("should insert the user's NODE_ENV as process.env.NODE_ENV if passed", async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      env: {
        NODE_ENV: 'production',
      },
    });

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.env') === -1);
    assert.equal(output(), 'production:production');
  });

  it('should insert environment variables from a file', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js'),
    );

    // Make sure dotenv doesn't leak its values into the main process's env
    assert(process.env.FOO == null);

    let output = await run(b);
    assert.equal(output, 'bartest');
  });

  it("should insert environment variables matching the user's NODE_ENV if passed", async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js'),
      {env: {NODE_ENV: 'production'}},
    );

    let output = await run(b);
    assert.equal(output, 'productiontest');
  });

  it('should replace process.browser for target browser', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'browser',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') === -1);
    assert.equal(output(), true);
  });

  it('should not touch process.browser for target node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'node',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') !== -1);
    assert.equal(output(), false);
  });

  it('should not touch process.browser for target electron-main', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'electron-main',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') !== -1);
    assert.equal(output(), false);
  });

  it('should replace process.browser for target electron-renderer', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/process/index.js'),
      {
        targets: {
          main: {
            context: 'electron-renderer',
            distDir: path.join(__dirname, '/integration/process/dist.js'),
          },
        },
      },
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.browser') === -1);
    assert.equal(output(), true);
    // Running the bundled code has the side effect of setting process.browser = true, which can mess
    // up the instantiation of typescript.sys within validator-typescript, so we want to reset it.
    process.browser = undefined;
  });

  it.skip('should support adding implicit dependencies', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json/index.js'), {
      delegate: {
        getImplicitDependencies(asset) {
          if (asset.basename === 'index.js') {
            return [{name: '../css/index.css'}];
          }
        },
      },
    });

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'local.json', 'index.css'],
      childBundles: [
        {
          type: 'css',
          assets: ['index.css'],
        },
        {
          type: 'map',
        },
      ],
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring YAML files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/yaml/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.yaml'],
        childBundles: [
          {
            type: 'map',
          },
        ],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring TOML files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/toml/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.toml'],
        childBundles: [
          {
            type: 'map',
          },
        ],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring CoffeeScript files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/coffee/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.coffee'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should resolve the browser field before main', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser.js'),
    );

    assertBundles(b, [
      {
        name: 'browser.js',
        assets: ['browser.js', 'browser-module.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-browser');
  });

  it('should exclude resolving specifiers that map to false in the browser field in browser builds', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-entries/pkg-ignore-browser/index.js',
      ),
      {
        targets: ['browsers'],
      },
    );

    assert.deepEqual(await run(b), {});
  });

  it('should not exclude resolving specifiers that map to false in the browser field in node builds', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-entries/pkg-ignore-browser/index.js',
      ),
      {
        targets: ['node'],
      },
    );

    assert.equal(await run(b), 'this should only exist in non-browser builds');
  });

  it.skip('should not resolve the browser field for --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser.js'),
      {
        target: 'node',
      },
    );

    assertBundles(b, {
      name: 'browser.js',
      assets: ['browser.js', 'node-module.js'],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-main');
  });

  it.skip('should resolve advanced browser resolution', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser-multiple.js'),
    );

    assertBundles(b, {
      name: 'browser-multiple.js',
      assets: [
        'browser-multiple.js',
        'projected-browser.js',
        'browser-entry.js',
      ],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let {test: output} = await run(b);

    assert.equal(typeof output.projected.test, 'function');
    assert.equal(typeof output.entry.test, 'function');
    assert.equal(output.projected.test(), 'pkg-browser-multiple');
    assert.equal(output.entry.test(), 'pkg-browser-multiple browser-entry');
  });

  it.skip('should not resolve advanced browser resolution with --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser-multiple.js'),
      {
        target: 'node',
      },
    );

    assertBundles(b, {
      name: 'browser-multiple.js',
      assets: ['browser-multiple.js', 'node-entry.js', 'projected.js'],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let {test: output} = await run(b);

    assert.equal(typeof output.projected.test, 'function');
    assert.equal(typeof output.entry.test, 'function');
    assert.equal(output.projected.test(), 'pkg-main-multiple');
    assert.equal(output.entry.test(), 'pkg-browser-multiple main-entry');
  });

  it.skip('should resolve the module field before main if scope-hoisting is enabled', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/module-field.js'),
      {scopeHoist: true},
    );

    assertBundles(b, [
      {
        name: 'module-field.js',
        assets: ['module-field.js', 'es6.module.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it.skip('should resolve the module field before main if scope-hoisting is enabled', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/both-fields.js'),
      {scopeHoist: true},
    );

    assertBundles(b, [
      {
        name: 'both-fields.js',
        assets: ['both-fields.js', 'es6.module.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it('should resolve the main field', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/main-field.js'),
    );

    assertBundles(b, [
      {
        name: 'main-field.js',
        assets: ['main-field.js', 'main.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-main-module');
  });

  it('should minify JSON files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/uglify-json/index.json'),
      {
        minify: true,
        scopeHoist: false,
      },
    );

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{"test":"test"}'));

    let output = await run(b);
    assert.deepEqual(output, {test: 'test'});
  });

  it('should minify JSON5 files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/uglify-json5/index.json5'),
      {
        minify: true,
        scopeHoist: false,
      },
    );

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{"test":"test"}'));

    let output = await run(b);
    assert.deepEqual(output, {test: 'test'});
  });

  it.skip('should minify YAML for production', async function() {
    let b = await bundle(path.join(__dirname, '/integration/yaml/index.js'), {
      minify: true,
      scopeHoist: false,
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let json = await outputFS.readFile('dist/index.js', 'utf8');
    assert(json.includes('{a:1,b:{c:2}}'));
  });

  it('should minify TOML for production', async function() {
    let b = await bundle(path.join(__dirname, '/integration/toml/index.js'), {
      minify: true,
      scopeHoist: false,
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{a:1,b:{c:2}}'));
  });

  it('should support optional dependencies in try...catch blocks', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/optional-dep/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(Object.getPrototypeOf(output).constructor.name, 'Error');
    assert(
      /Cannot find module ['"]optional-dep['"]/.test(output.message),
      'Should set correct error message',
    );
    assert.equal(output.code, 'MODULE_NOT_FOUND');
  });

  it('should support excluding dependencies in falsy branches', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/falsy-dep/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'true-alternate.js', 'true-consequent.js'],
      },
    ]);

    let output = await run(b);
    assert.equal(output, 2);
  });

  it.skip('should not autoinstall if resolve failed on installed module', async function() {
    let error;
    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/dont-autoinstall-resolve-fails/index.js',
        ),
      );
    } catch (err) {
      error = err;
    }
    assert.equal(
      error.message,
      `Cannot resolve dependency 'vue/thisDoesNotExist'`,
    );
    assert.equal(error.code, 'MODULE_NOT_FOUND');
  });

  it.skip('should not autoinstall if resolve failed on aliased module', async function() {
    let error;
    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/dont-autoinstall-resolve-alias-fails/index.js',
        ),
      );
    } catch (err) {
      error = err;
    }
    assert.equal(
      error.message,
      `Cannot resolve dependency 'aliasVue/thisDoesNotExist'`,
    );
    assert.equal(error.code, 'MODULE_NOT_FOUND');
  });

  it('should ignore require if it is defined in the scope', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/require-scope/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js'],
      },
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'object');

    let failed = Object.keys(output.test).some(
      key => output.test[key] !== 'test passed',
    );

    assert.equal(failed, false);
  });

  it('should expose to CommonJS entry point', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/entry-point/index.js'),
    );

    let module = {};
    await run(b, {module, exports: {}});
    assert.equal(module.exports(), 'Test!');
  });

  it('should expose to RequireJS entry point', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/entry-point/index.js'),
    );
    let test;
    const mockDefine = function(f) {
      test = f();
    };
    mockDefine.amd = true;

    await run(b, {define: mockDefine, module: undefined});
    assert.equal(test(), 'Test!');
  });

  it.skip('should expose variable with --browser-global', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/entry-point/index.js'),
      {
        global: 'testing',
      },
    );

    const ctx = await run(b, {module: undefined}, {require: false});
    assert.equal(ctx.window.testing(), 'Test!');
  });

  it.skip('should set `define` to undefined so AMD checks in UMD modules do not pass', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/define-amd/index.js'),
    );
    let test;
    const mockDefine = function(f) {
      test = f();
    };
    mockDefine.amd = true;

    await run(b, {define: mockDefine, module: undefined});
    assert.equal(test, 2);
  });

  it('should package successfully with comments on last line', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-comment/index.js`),
    );

    let output = await run(b);
    assert.equal(output, 'Hello World!');
  });

  it('should package successfully with comments on last line and minification', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-comment/index.js`),
    );

    let output = await run(b);
    assert.equal(output, 'Hello World!');
  });

  it('should package successfully with comments on last line and scope hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-comment/index.js`),
      {
        scopeHoist: true,
      },
    );

    let output = await run(b);
    assert.equal(output, 'Hello World!');
  });

  it('should package successfully with comments on last line, scope hoisting and minification', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-comment/index.js`),
      {
        scopeHoist: true,
        minify: true,
      },
    );

    let output = await run(b);
    assert.equal(output, 'Hello World!');
  });

  it('should not replace toplevel this with undefined in CommonJS without scope-hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/js-this-commonjs/a.js'),
    );

    let output;
    function result(v) {
      output = v;
    }
    await run(b, {result});
    assert.deepEqual(output, [{foo: 2}, 1234]);
  });

  it('should not replace toplevel this with undefined in CommonJS when scope-hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/js-this-commonjs/a.js'),
      {scopeHoist: true},
    );

    let output;
    function result(v) {
      output = v;
    }
    await run(b, {result});
    assert.deepEqual(output, [{foo: 2}, 1234]);
  });

  it('should replace toplevel this with undefined in ESM without scope-hoisting', async function() {
    let b = await bundle(path.join(__dirname, '/integration/js-this-es6/a.js'));

    let output;
    function result(v) {
      output = v;
    }
    await run(b, {result});
    assert.deepEqual(output, [undefined, 1234]);
  });

  it('should replace toplevel this with undefined in ESM when scope-hoisting', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/js-this-es6/a.js'),
      {scopeHoist: true},
    );

    let output;
    function result(v) {
      output = v;
    }
    await run(b, {result});
    assert.deepEqual(output, [undefined, 1234]);
  });

  it.skip('should not dedupe imports with different contents', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-different-contents/index.js`),
      {
        hmr: false, // enable asset dedupe in JSPackager
      },
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello World!');
  });

  it.skip('should not dedupe imports with same content but different absolute dependency paths', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        `/integration/js-same-contents-different-dependencies/index.js`,
      ),
      {
        hmr: false, // enable asset dedupe in JSPackager
      },
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello World!');
  });

  it.skip('should dedupe imports with same content and same dependency paths', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        `/integration/js-same-contents-same-dependencies/index.js`,
      ),
      {
        hmr: false, // enable asset dedupe in JSPackager
      },
    );
    const {rootDir} = b.entryAsset.options;
    const writtenAssets = Array.from(b.offsets.keys()).map(asset => asset.name);
    assert.equal(writtenAssets.length, 2);
    assert(writtenAssets.includes(path.join(rootDir, 'index.js')));
    assert(
      writtenAssets.includes(path.join(rootDir, 'hello1.js')) ||
        writtenAssets.includes(path.join(rootDir, 'hello2.js')),
    );
    assert(
      !(
        writtenAssets.includes(path.join(rootDir, 'hello1.js')) &&
        writtenAssets.includes(path.join(rootDir, 'hello2.js'))
      ),
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello Hello!');
  });

  it.skip('should not dedupe assets that exist in more than one bundle', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-dedup-hoist/index.js`),
      {
        hmr: false, // enable asset dedupe in JSPackager
      },
    );
    const {rootDir} = b.entryAsset.options;
    const writtenAssets = Array.from(b.offsets.keys()).map(asset => asset.name);
    assert(
      writtenAssets.includes(path.join(rootDir, 'hello1.js')) &&
        writtenAssets.includes(path.join(rootDir, 'hello2.js')),
    );

    let module = await run(b);
    assert.equal(await module.default(), 'Hello Hello! Hello');
  });

  it.skip('should support importing HTML from JS async', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-async/index.js'),
      {sourceMaps: false},
    );

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'cacheLoader.js', 'html-loader.js'],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: [],
            },
            {
              type: 'css',
              assets: ['index.css'],
            },
          ],
        },
      ],
    });

    let output = await run(b);
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it.skip('should support importing HTML from JS async with --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-async/index.js'),
      {
        target: 'node',
        sourceMaps: false,
      },
    );

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'cacheLoader.js', 'html-loader.js'],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: [],
            },
            {
              type: 'css',
              assets: ['index.css'],
            },
          ],
        },
      ],
    });

    let output = await run(b);
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it.skip('should support importing HTML from JS sync', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-sync/index.js'),
      {
        sourceMaps: false,
      },
    );

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'cacheLoader.js', 'html-loader.js'],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: [],
            },
            {
              type: 'css',
              assets: ['index.css'],
            },
          ],
        },
      ],
    });

    let {deferred, promise} = makeDeferredWithPromise();
    await run(b, {output: deferred.resolve}, {require: false});
    let output = await promise;
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it.skip('should stub require.cache', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require_cache/main.js'),
      {
        target: 'node',
      },
    );

    await run(b);
  });

  it('should support async importing the same module from different bundles', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/shared-bundlegroup/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['a.js', 'JSRuntime.js'],
      },
      {
        assets: ['b.js', 'JSRuntime.js'],
      },
      {
        assets: ['c.js'],
      },
    ]);

    let {default: promise} = await run(b);
    assert.deepEqual(await promise, ['hello from a test', 'hello from b test']);
  });

  it('should not create shared bundles from contents of entries', async () => {
    let b = await bundle(
      ['a.js', 'b.js'].map(entry =>
        path.join(
          __dirname,
          '/integration/no-shared-bundles-from-entries/',
          entry,
        ),
      ),
    );

    assertBundles(b, [
      {
        name: 'a.js',
        assets: ['a.js', 'lodash.js'],
      },
      {
        name: 'b.js',
        assets: ['b.js', 'lodash.js'],
      },
    ]);
  });

  it('should import the same dependency multiple times in the same bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/same-dependency-multiple-times/a1.js'),
    );

    await run(b);
  });

  it("should inline a bundle's compiled text with `bundle-text`", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/index.js'),
    );

    assert(
      (await run(b)).default.startsWith(
        `body {
  background-color: #000000;
}

.svg-img {
  background-image: url("data:image/svg+xml,%3Csvg%3E%0A%0A%3C%2Fsvg%3E%0A");
}
/*# sourceMappingURL=data:application/json;charset=utf-8;base64,`,
      ),
    );
  });

  it('should inline text content as url-encoded text and mime type with `data-url:*` imports', async () => {
    let b = await bundle(path.join(__dirname, '/integration/data-url/text.js'));

    assert.equal(
      (await run(b)).default,
      'data:image/svg+xml,%3Csvg%20width%3D%22120%22%20height%3D%27120%27%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%0A%20%20%3Cfilter%20id%3D%22blur-_.%21~%2a%22%3E%0A%20%20%20%20%3CfeGaussianBlur%20stdDeviation%3D%225%22%2F%3E%0A%20%20%3C%2Ffilter%3E%0A%20%20%3Ccircle%20cx%3D%2260%22%20cy%3D%2260%22%20r%3D%2250%22%20fill%3D%22green%22%20filter%3D%22url%28%23blur-_.%21~%2a%29%22%20%2F%3E%0A%3C%2Fsvg%3E%0A',
    );
  });

  it('should inline binary content as url-encoded base64 and mime type with `data-url:*` imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/data-url/binary.js'),
    );
    ``;

    assert((await run(b)).default.startsWith('data:image/webp;base64,UklGR'));
  });

  // FIXME
  it.skip('should support both pipeline and non-pipeline imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/multi-pipeline/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', b.getBundles().find(b => b.isInline).id + '.js'],
      },
      {
        name: 'index.css',
        assets: ['style.css'],
      },
      {
        type: 'css',
        assets: ['style.css'],
      },
    ]);

    assert((await run(b)).default.startsWith('.test'));
  });

  it('should detect typescript style async requires in commonjs', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/ts.js'),
    );

    assertBundles(b, [
      {
        name: 'ts.js',
        assets: [
          'ts.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.equal(await run(b), 2);
  });

  it('should detect typescript style async requires in commonjs with esModuleInterop flag', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/ts-interop.js'),
    );

    assertBundles(b, [
      {
        name: 'ts-interop.js',
        assets: [
          'ts-interop.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.deepEqual(await run(b), {default: 2});

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath, 'utf8');
    assert(/.then\(function \(\$parcel\$.*?\) {/.test(contents));
  });

  it('should detect typescript style async requires in commonjs with esModuleInterop flag and arrow functions', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/ts-interop-arrow.js'),
    );

    assertBundles(b, [
      {
        name: 'ts-interop-arrow.js',
        assets: [
          'ts-interop-arrow.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.deepEqual(await run(b), {default: 2});

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath, 'utf8');
    assert(/.then\(\$parcel\$.*? =>/.test(contents));
  });

  it('should detect rollup style async requires in commonjs', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/rollup.js'),
    );

    assertBundles(b, [
      {
        name: 'rollup.js',
        assets: [
          'rollup.js',
          'bundle-manifest.js',
          'JSRuntime.js',
          'relative-path.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.equal(await run(b), 2);
  });

  it('should detect parcel style async requires in commonjs', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/require-async/parcel.js'),
    );

    assertBundles(b, [
      {
        name: 'parcel.js',
        assets: [
          'parcel.js',
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        assets: ['async.js'],
      },
    ]);

    assert.equal(await run(b), 2);
  });

  // FIXME
  it.skip('only updates bundle names of changed bundles for browsers', async () => {
    let fixtureDir = path.join(__dirname, '/integration/name-invalidation');
    let _bundle = () =>
      bundle(path.join(fixtureDir, 'index.js'), {
        inputFS: overlayFS,
      });

    let first = await _bundle();
    assert.equal(await (await run(first)).default, 42);

    let bPath = path.join(fixtureDir, 'b.js');
    await overlayFS.mkdirp(fixtureDir);
    overlayFS.writeFile(
      bPath,
      (await overlayFS.readFile(bPath, 'utf8')).replace('42', '43'),
    );

    let second = await _bundle();
    assert.equal(await (await run(second)).default, 43);

    let getBundleNameWithPrefix = (b, prefix) =>
      b
        .getBundles()
        .map(bundle => bundle.name)
        .find(name => name.startsWith(prefix));

    assert.equal(
      getBundleNameWithPrefix(first, 'a'),
      getBundleNameWithPrefix(second, 'a'),
    );
    assert.notEqual(
      getBundleNameWithPrefix(first, 'b'),
      getBundleNameWithPrefix(second, 'b'),
    );
  });

  it('can load the same resource when referenced in multiple bundles', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/same-resource-multiple-bundles/index.js',
      ),
    );

    let res = await run(b);
    assert(url.parse(await res.default()).pathname.startsWith('/resource'));
  });

  it('can static import and dynamic import in the same bundle without creating a new bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/sync-async/same-bundle.js'),
    );

    assertBundles(b, [
      {
        name: 'same-bundle.js',
        assets: [
          'same-bundle.js',
          'get-dep.js',
          'get-dep-2.js',
          'dep.js',
          'JSRuntime.js',
        ],
      },
    ]);

    assert.deepEqual(await (await run(b)).default, [42, 42, 42]);
  });

  it('can static import and dynamic import in the same bundle ancestry without creating a new bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/sync-async/same-ancestry.js'),
    );

    assertBundles(b, [
      {
        name: 'same-ancestry.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'dep.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
          'same-ancestry.js',
        ],
      },
      {
        assets: ['get-dep.js', 'JSRuntime.js'],
      },
    ]);

    assert.deepEqual(await (await run(b)).default, [42, 42]);
  });

  it('can static import and dynamic import in the same bundle when another bundle requires async', async () => {
    let b = await bundle(
      ['same-bundle.js', 'get-dep.js'].map(entry =>
        path.join(__dirname, '/integration/sync-async/', entry),
      ),
    );

    assertBundles(b, [
      {
        assets: ['dep.js'],
      },
      {
        name: 'same-bundle.js',
        assets: [
          'same-bundle.js',
          'get-dep.js',
          'get-dep-2.js',
          'dep.js',
          'JSRuntime.js',
        ],
      },
      {
        name: 'get-dep.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'get-dep.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
    ]);

    let bundles = b.getBundles();
    let sameBundle = bundles.find(b => b.name === 'same-bundle.js');
    let getDep = bundles.find(b => b.name === 'get-dep.js');

    assert.deepEqual(await (await runBundle(b, sameBundle)).default, [
      42,
      42,
      42,
    ]);
    assert.deepEqual(await (await runBundle(b, getDep)).default, 42);
  });

  it("can share dependencies between a shared bundle and its sibling's descendants", async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/shared-exports-for-sibling-descendant/index.js',
      ),
    );

    assertBundles(b, [
      {
        assets: ['wraps.js', 'lodash.js'],
      },
      {
        assets: ['a.js', 'JSRuntime.js'],
      },
      {
        assets: ['child.js', 'JSRuntime.js'],
      },
      {
        assets: ['grandchild.js'],
      },
      {
        assets: ['b.js'],
      },
      {
        name: 'index.js',
        assets: [
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'index.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
    ]);

    assert.deepEqual(await (await run(b)).default, [3, 5]);
  });

  it('can run an entry bundle whose entry asset is present in another bundle', async () => {
    let b = await bundle(
      ['index.js', 'value.js'].map(basename =>
        path.join(__dirname, '/integration/sync-entry-shared', basename),
      ),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {name: 'value.js', assets: ['value.js']},
      {assets: ['async.js']},
    ]);

    assert.equal(await (await run(b)).default, 43);
  });

  it('can run an async bundle whose entry asset is present in another bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/async-entry-shared/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {assets: ['value.js']},
      {assets: ['async.js']},
    ]);

    assert.deepEqual(await (await run(b)).default, [42, 43]);
  });

  it('should display a codeframe on a Terser parse error', async () => {
    let fixture = path.join(__dirname, 'integration/terser-codeframe/index.js');
    let code = await inputFS.readFileSync(fixture, 'utf8');
    await assert.rejects(
      () =>
        bundle(fixture, {
          minify: true,
        }),
      {
        name: 'BuildError',
        diagnostics: [
          {
            message: 'Name expected',
            origin: '@parcel/optimizer-terser',
            filePath: undefined,
            language: 'js',
            codeFrame: {
              code,
              codeHighlights: [
                {
                  message: 'Name expected',
                  start: {
                    column: 4,
                    line: 1,
                  },
                  end: {
                    column: 4,
                    line: 1,
                  },
                },
              ],
            },
            hints: ["It's likely that Terser doesn't support this syntax yet."],
          },
        ],
      },
    );
  });

  it('can run an async bundle that depends on a nonentry asset in a sibling', async () => {
    let b = await bundle(
      ['index.js', 'other-entry.js'].map(basename =>
        path.join(
          __dirname,
          '/integration/async-entry-shared-sibling',
          basename,
        ),
      ),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {
        name: 'other-entry.js',
        assets: [
          'other-entry.js',
          'bundle-manifest.js',
          'bundle-url.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'relative-path.js',
        ],
      },
      {assets: ['a.js', 'value.js']},
      {assets: ['b.js']},
    ]);

    assert.deepEqual(await (await run(b)).default, 43);
  });
});
