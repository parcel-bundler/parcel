import assert from 'assert';
import path from 'path';
import {
  bundle,
  bundler,
  run,
  assertBundles,
  removeDistDirectory,
  distDir,
  outputFS,
  inputFS
} from '@parcel/test-utils';
import {makeDeferredWithPromise} from '@parcel/utils';

describe('javascript', function() {
  beforeEach(async () => {
    await removeDistDirectory();
  });

  it('should produce a basic JS bundle with CommonJS requires', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/commonjs/index.js')
    );

    // assert.equal(b.assets.size, 8);
    // assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
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
      path.join(__dirname, '/integration/dependency-prior-transform/index.js')
    );

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath);

    assert(!contents.includes('import'));
  });

  it('should produce a basic JS bundle with object rest spread support', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/object-rest-spread/object-rest-spread.js'
      )
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
      path.join(__dirname, '/integration/node_require_browser/main.js')
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js', 'index.js']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should not bundle node_modules for a node environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js')
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js']
      }
    ]);

    await outputFS.mkdirp(path.join(distDir, 'node_modules/testmodule'));
    await outputFS.writeFile(
      path.join(distDir, 'node_modules/testmodule/index.js'),
      'exports.a = 5;'
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it.skip('should not bundle node_modules on --target=electron', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'electron'
      }
    );

    assertBundles(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js']
    });

    await outputFS.mkdirp(path.join(distDir, 'node_modules/testmodule'));
    await outputFS.writeFile(
      path.join(distDir, 'node_modules/testmodule/index.js'),
      'exports.a = 5;'
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
      (await inputFS.stat(path.join(fixturePath, 'main.js'))).mode
    );
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should not preserve hashbangs in browser bundles', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(fixturePath, 'main.js'));

    let main = await outputFS.readFile(
      path.join(fixturePath, 'dist', 'browser', 'main.js'),
      'utf8'
    );
    assert(!main.includes('#!/usr/bin/env node\n'));
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should preserve hashbangs in scopehoisted bundles', async () => {
    let fixturePath = path.join(__dirname, '/integration/node_hashbang');
    await bundle(path.join(__dirname, '/integration/node_hashbang/main.js'), {
      scopeHoist: true
    });

    let main = await outputFS.readFile(
      path.join(fixturePath, 'dist', 'node', 'main.js'),
      'utf8'
    );
    assert.equal(main.lastIndexOf('#!/usr/bin/env node\n'), 0);
    await outputFS.rimraf(path.join(fixturePath, 'dist'));
  });

  it('should bundle node_modules for a node environment if includeNodeModules is specified', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/include_node_modules/main.js')
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js', 'local.js', 'index.js']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should bundle builtins for a browser environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/include_builtins-browser/main.js')
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['_empty.js', 'browser.js', 'index.js', 'main.js']
      }
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
      path.join(__dirname, '/integration/include_builtins-node/main.js')
    );

    assertBundles(b, [
      {
        name: 'main.js',
        assets: ['main.js']
      }
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
        bundleNodeModules: true
      }
    );

    assertBundles(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js', 'index.js']
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should produce a JS bundle with default exports and no imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/es6-default-only/index.js')
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
        assets: ['index.js', 'cacheLoader.js', 'js-loader.js', 'JSRuntime.js']
      },
      {
        assets: ['local.js']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should split bundles when a dynamic import is used with a node environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-node/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'JSRuntime.js']
      },
      {
        assets: ['local.js']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it.skip('should load dynamic bundle when entry is in a subdirectory', async function() {
    let bu = await bundler(
      path.join(
        __dirname,
        '/integration/dynamic-subdirectory/subdirectory/index.js'
      ),
      {
        target: 'browser'
      }
    );
    // Set the rootDir to make sure subdirectory is preserved
    bu.options.rootDir = path.join(
      __dirname,
      '/integration/dynamic-subdirectory'
    );
    let b = await bu.bundle();
    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('Should not run parcel over external modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-external/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      }
    ]);
  });

  it('should support bundling workers', async function() {
    let b = await bundle(path.join(__dirname, '/integration/workers/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'common.js', 'worker-client.js', 'feature.js']
      },
      {
        assets: ['service-worker.js']
      },
      {
        assets: ['shared-worker.js']
      },
      {
        assets: ['worker.js', 'common.js']
      }
    ]);
  });

  it('should support bundling workers of type module', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers-module/index.js'),
      {scopeHoist: true}
    );

    assertBundles(b, [
      {
        assets: ['dedicated-worker.js']
      },
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        assets: ['shared-worker.js']
      }
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
      path.join(__dirname, '/integration/workers/index-alternative.js')
    );

    assertBundles(b, [
      {
        name: 'index-alternative.js',
        assets: [
          'index-alternative.js',
          'common.js',
          'worker-client.js',
          'feature.js'
        ]
      },
      {
        assets: ['service-worker.js']
      },
      {
        assets: ['shared-worker.js']
      },
      {
        assets: ['worker.js', 'common.js']
      }
    ]);
  });

  it('should support bundling service-workers', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/service-worker/a/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'index.js']
      },
      {
        assets: ['worker-nested.js']
      },
      {
        assets: ['worker-outside.js']
      }
    ]);
  });

  it('should support bundling workers with circular dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-circular/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      },
      {
        assets: ['worker.js', 'worker-dep.js']
      }
    ]);
  });

  it.skip('should support bundling in workers with other loaders', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers-with-other-loaders/index.js')
    );

    assertBundles(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'worker-client.js',
        'cacheLoader.js',
        'js-loader.js',
        'wasm-loader.js'
      ],
      childBundles: [
        {
          type: 'wasm',
          assets: ['add.wasm'],
          childBundles: []
        },
        {
          type: 'map'
        },
        {
          assets: ['worker.js', 'cacheLoader.js', 'wasm-loader.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should not deduplicate assets from a parent bundle in workers', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-no-deduplicate/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'lodash.js']
      },
      {
        assets: ['worker-a.js', 'lodash.js']
      },
      {
        assets: ['worker-b.js', 'lodash.js']
      }
    ]);
  });

  it('should dynamic import files which import raw files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-references-raw/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'cacheLoader.js', 'js-loader.js', 'JSRuntime.js']
      },
      {
        assets: ['local.js', 'test.txt.js']
      },
      {
        assets: ['test.txt']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should return all exports as an object when using ES modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-esm/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'cacheLoader.js', 'js-loader.js', 'JSRuntime.js']
      },
      {
        assets: ['local.js']
      }
    ]);

    let output = (await run(b)).default;
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should duplicate small modules across multiple bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-common-small/index.js')
    );

    assertBundles(b, [
      {
        assets: ['a.js', 'common.js', 'common-dep.js']
      },
      {
        assets: ['b.js', 'common.js', 'common-dep.js']
      },
      {
        name: 'index.js',
        assets: [
          'index.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js'
        ]
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should create a separate bundle for large modules shared between bundles', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-common-large/index.js')
    );

    assertBundles(b, [
      {
        assets: ['a.js']
      },
      {
        assets: ['b.js']
      },
      {
        name: 'index.js',
        assets: [
          'index.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js'
        ]
      },
      {
        assets: ['common.js', 'lodash.js']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should not duplicate a module which is already in a parent bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-hoist-dup/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'common.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js'
        ]
      },
      {
        assets: ['a.js']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 5);
  });

  it('should duplicate a module if it is not present in every parent bundle', async function() {
    let b = await bundle(
      ['a.js', 'b.js'].map(entry =>
        path.join(__dirname, 'integration/dynamic-hoist-no-dedupe', entry)
      )
    );
    assertBundles(b, [
      {
        assets: ['c.js', 'common.js']
      },
      {
        name: 'b.js',
        assets: ['b.js', 'cacheLoader.js', 'js-loader.js', 'JSRuntime.js']
      },
      {
        name: 'a.js',
        assets: [
          'a.js',
          'common.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js'
        ]
      }
    ]);
  });

  it('should support shared modules with async imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-hoist-deep/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'cacheLoader.js',
          'js-loader.js',
          'JSRuntime.js',
          'JSRuntime.js'
        ]
      },
      {
        assets: ['a.js', 'c.js', 'JSRuntime.js']
      },
      {
        assets: ['b.js', 'c.js', 'JSRuntime.js']
      },
      {
        assets: ['1.js']
      }
    ]);

    let {default: promise} = await run(b);
    assert.ok(await promise);
  });

  it('should support requiring JSON files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json/index.js'));

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'local.json']
      }
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
        assets: ['index.js', 'local.json5']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support importing a URL to a raw asset', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-raw/index.js'),
      {disableCache: false}
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'test.txt.js']
      },
      {
        type: 'txt',
        assets: ['test.txt']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(/^\/test\.[0-9a-f]+\.txt$/.test(output()));
    let stats = await outputFS.stat(path.join(distDir, output()));
    assert.equal(stats.size, 9);
  });

  it('should minify JS in production mode', async function() {
    let b = await bundle(path.join(__dirname, '/integration/uglify/index.js'), {
      minify: true,
      scopeHoist: false
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
      scopeHoist: false
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
      buf: new Buffer('browser').toString('base64'),
      global: true
    });
  });

  it('should handle re-declaration of the global constant', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/global-redeclare/index.js')
    );

    let output = await run(b);
    assert.deepEqual(output(), false);
  });

  it('should insert environment variables inserted by a prior transform', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/env-prior-transform/index.js')
    );

    let jsBundle = b.getBundles()[0];
    let contents = await outputFS.readFile(jsBundle.filePath);

    assert(!contents.includes('process.env'));
    assert.equal(await run(b), 42);
  });

  it('should not insert environment variables in node environment', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-node/index.js')
    );

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.env') > -1);
    assert.equal(output(), 'test:test');
  });

  it.skip('should not insert environment variables in electron environment', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      target: 'electron'
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

  it('should insert environment variables from a file', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js')
    );

    // Make sure dotenv doesn't leak its values into the main process's env
    assert(process.env.FOO == null);

    let output = await run(b);
    assert.equal(output, 'bartest');
  });

  it.skip('should support adding implicit dependencies', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json/index.js'), {
      delegate: {
        getImplicitDependencies(asset) {
          if (asset.basename === 'index.js') {
            return [{name: '../css/index.css'}];
          }
        }
      }
    });

    assertBundles(b, {
      name: 'index.js',
      assets: ['index.js', 'local.json', 'index.css'],
      childBundles: [
        {
          type: 'css',
          assets: ['index.css']
        },
        {
          type: 'map'
        }
      ]
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
            type: 'map'
          }
        ]
      }
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
            type: 'map'
          }
        ]
      }
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
        assets: ['index.js', 'local.coffee']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should resolve the browser field before main', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser.js')
    );

    assertBundles(b, [
      {
        name: 'browser.js',
        assets: ['browser.js', 'browser-module.js']
      }
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-browser');
  });

  it.skip('should not resolve the browser field for --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser.js'),
      {
        target: 'node'
      }
    );

    assertBundles(b, {
      name: 'browser.js',
      assets: ['browser.js', 'node-module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-main');
  });

  it.skip('should resolve advanced browser resolution', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser-multiple.js')
    );

    assertBundles(b, {
      name: 'browser-multiple.js',
      assets: [
        'browser-multiple.js',
        'projected-browser.js',
        'browser-entry.js'
      ],
      childBundles: [
        {
          type: 'map'
        }
      ]
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
        target: 'node'
      }
    );

    assertBundles(b, {
      name: 'browser-multiple.js',
      assets: ['browser-multiple.js', 'node-entry.js', 'projected.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let {test: output} = await run(b);

    assert.equal(typeof output.projected.test, 'function');
    assert.equal(typeof output.entry.test, 'function');
    assert.equal(output.projected.test(), 'pkg-main-multiple');
    assert.equal(output.entry.test(), 'pkg-browser-multiple main-entry');
  });

  it('should resolve the module field before main', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/module-field.js')
    );

    assertBundles(b, [
      {
        name: 'module-field.js',
        assets: ['module-field.js', 'es6.module.js']
      }
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it('should resolve the module field before main', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/both-fields.js')
    );

    assertBundles(b, [
      {
        name: 'both-fields.js',
        assets: ['both-fields.js', 'es6.module.js']
      }
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it('should resolve the main field', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/main-field.js')
    );

    assertBundles(b, [
      {
        name: 'main-field.js',
        assets: ['main-field.js', 'main.js']
      }
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-main-module');
  });

  it('should minify JSON files', async function() {
    await bundle(path.join(__dirname, '/integration/uglify-json/index.json'), {
      minify: true,
      scopeHoist: false
    });

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{test:"test"}'));
  });

  it('should minify JSON5 files', async function() {
    await bundle(
      path.join(__dirname, '/integration/uglify-json5/index.json5'),
      {
        minify: true,
        scopeHoist: false
      }
    );

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{test:"test"}'));
  });

  it.skip('should minify YAML for production', async function() {
    let b = await bundle(path.join(__dirname, '/integration/yaml/index.js'), {
      minify: true,
      scopeHoist: false
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
      scopeHoist: false
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{a:1,b:{c:2}}'));
  });

  it('should support optional dependencies in try...catch blocks', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/optional-dep/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      }
    ]);

    let output = await run(b);

    assert.equal(Object.getPrototypeOf(output).constructor.name, 'Error');
    assert(
      /Cannot find module ['"]optional-dep['"]/.test(output.message),
      'Should set correct error message'
    );
    assert.equal(output.code, 'MODULE_NOT_FOUND');
  });

  it('should support excluding dependencies in falsy branches', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/falsy-dep/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'true-alternate.js', 'true-consequent.js']
      }
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
          '/integration/dont-autoinstall-resolve-fails/index.js'
        )
      );
    } catch (err) {
      error = err;
    }
    assert.equal(
      error.message,
      `Cannot resolve dependency 'vue/thisDoesNotExist'`
    );
    assert.equal(error.code, 'MODULE_NOT_FOUND');
  });

  it.skip('should not autoinstall if resolve failed on aliased module', async function() {
    let error;
    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/dont-autoinstall-resolve-alias-fails/index.js'
        )
      );
    } catch (err) {
      error = err;
    }
    assert.equal(
      error.message,
      `Cannot resolve dependency 'aliasVue/thisDoesNotExist'`
    );
    assert.equal(error.code, 'MODULE_NOT_FOUND');
  });

  it('should ignore require if it is defined in the scope', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/require-scope/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js']
      }
    ]);

    let output = await run(b);

    assert.equal(typeof output.test, 'object');

    let failed = Object.keys(output.test).some(
      key => output.test[key] !== 'test passed'
    );

    assert.equal(failed, false);
  });

  it('should expose to CommonJS entry point', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/entry-point/index.js')
    );

    let module = {};
    await run(b, {module, exports: {}});
    assert.equal(module.exports(), 'Test!');
  });

  it('should expose to RequireJS entry point', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/entry-point/index.js')
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
        global: 'testing'
      }
    );

    const ctx = await run(b, {module: undefined}, {require: false});
    assert.equal(ctx.window.testing(), 'Test!');
  });

  it.skip('should set `define` to undefined so AMD checks in UMD modules do not pass', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/define-amd/index.js')
    );
    let test;
    const mockDefine = function(f) {
      test = f();
    };
    mockDefine.amd = true;

    await run(b, {define: mockDefine, module: undefined});
    assert.equal(test, 2);
  });

  it.skip('should not dedupe imports with different contents', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-different-contents/index.js`),
      {
        hmr: false // enable asset dedupe in JSPackager
      }
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello World!');
  });

  it.skip('should not dedupe imports with same content but different absolute dependency paths', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        `/integration/js-same-contents-different-dependencies/index.js`
      ),
      {
        hmr: false // enable asset dedupe in JSPackager
      }
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello World!');
  });

  it.skip('should dedupe imports with same content and same dependency paths', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        `/integration/js-same-contents-same-dependencies/index.js`
      ),
      {
        hmr: false // enable asset dedupe in JSPackager
      }
    );
    const {rootDir} = b.entryAsset.options;
    const writtenAssets = Array.from(b.offsets.keys()).map(asset => asset.name);
    assert.equal(writtenAssets.length, 2);
    assert(writtenAssets.includes(path.join(rootDir, 'index.js')));
    assert(
      writtenAssets.includes(path.join(rootDir, 'hello1.js')) ||
        writtenAssets.includes(path.join(rootDir, 'hello2.js'))
    );
    assert(
      !(
        writtenAssets.includes(path.join(rootDir, 'hello1.js')) &&
        writtenAssets.includes(path.join(rootDir, 'hello2.js'))
      )
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello Hello!');
  });

  it.skip('should not dedupe assets that exist in more than one bundle', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-dedup-hoist/index.js`),
      {
        hmr: false // enable asset dedupe in JSPackager
      }
    );
    const {rootDir} = b.entryAsset.options;
    const writtenAssets = Array.from(b.offsets.keys()).map(asset => asset.name);
    assert(
      writtenAssets.includes(path.join(rootDir, 'hello1.js')) &&
        writtenAssets.includes(path.join(rootDir, 'hello2.js'))
    );

    let module = await run(b);
    assert.equal(await module.default(), 'Hello Hello! Hello');
  });

  it.skip('should support importing HTML from JS async', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-async/index.js'),
      {sourceMaps: false}
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
              childBundles: []
            },
            {
              type: 'css',
              assets: ['index.css']
            }
          ]
        }
      ]
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
        sourceMaps: false
      }
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
              childBundles: []
            },
            {
              type: 'css',
              assets: ['index.css']
            }
          ]
        }
      ]
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
        sourceMaps: false
      }
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
              childBundles: []
            },
            {
              type: 'css',
              assets: ['index.css']
            }
          ]
        }
      ]
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
        target: 'node'
      }
    );

    await run(b);
  });

  it('should support async importing the same module from different bundles', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/shared-bundlegroup/index.js')
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'JSRuntime.js',
          'JSRuntime.js',
          'cacheLoader.js',
          'js-loader.js'
        ]
      },
      {
        assets: ['a.js', 'JSRuntime.js']
      },
      {
        assets: ['b.js', 'JSRuntime.js']
      },
      {
        assets: ['c.js']
      }
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
          entry
        )
      )
    );

    assertBundles(b, [
      {
        name: 'a.js',
        assets: ['a.js', 'lodash.js']
      },
      {
        name: 'b.js',
        assets: ['b.js', 'lodash.js']
      }
    ]);
  });

  it('should import the same dependency multiple times in the same bundle', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/same-dependency-multiple-times/a1.js')
    );

    await run(b);
  });
});
