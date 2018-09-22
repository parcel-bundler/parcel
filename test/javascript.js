const assert = require('assert');
const fs = require('../src/utils/fs');
const path = require('path');
const {bundle, run, assertBundleTree, deferred, ncp} = require('./utils');
const {mkdirp} = require('../src/utils/fs');
const {symlinkSync} = require('fs');

describe('javascript', function() {
  it('should produce a basic JS bundle with CommonJS requires', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/commonjs/index.js')
    );

    assert.equal(b.assets.size, 8);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should produce a basic JS bundle with ES6 imports', async function() {
    let b = await bundle(path.join(__dirname, '/integration/es6/index.js'));

    assert.equal(b.assets.size, 8);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should produce a basic JS bundle using Babel 6', async function() {
    let b = await bundle(
      __dirname + '/integration/babel-6-compatibility/index.js'
    );

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should auto install babel-core v6', async function() {
    let originalPkg = await fs.readFile(
      __dirname + '/integration/babel-6-autoinstall/package.json'
    );
    let b = await bundle(
      __dirname + '/integration/babel-6-autoinstall/index.js'
    );

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);

    let pkg = await fs.readFile(
      __dirname + '/integration/babel-6-autoinstall/package.json'
    );
    assert(JSON.parse(pkg).devDependencies['babel-core']);
    await fs.writeFile(
      __dirname + '/integration/babel-6-autoinstall/package.json',
      originalPkg
    );
  });

  it('should auto install @babel/core v7', async function() {
    let originalPkg = await fs.readFile(
      __dirname + '/integration/babel-7-autoinstall/package.json'
    );
    let b = await bundle(
      __dirname + '/integration/babel-7-autoinstall/index.js'
    );

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);

    let pkg = await fs.readFile(
      __dirname + '/integration/babel-7-autoinstall/package.json'
    );
    assert(JSON.parse(pkg).devDependencies['@babel/core']);
    await fs.writeFile(
      __dirname + '/integration/babel-7-autoinstall/package.json',
      originalPkg
    );
  });

  it('should auto install babel plugins', async function() {
    let originalPkg = await fs.readFile(
      __dirname + '/integration/babel-plugin-autoinstall/package.json'
    );
    let b = await bundle(
      __dirname + '/integration/babel-plugin-autoinstall/index.js'
    );

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);

    let pkg = await fs.readFile(
      __dirname + '/integration/babel-plugin-autoinstall/package.json'
    );
    assert(JSON.parse(pkg).devDependencies['@babel/core']);
    assert(
      JSON.parse(pkg).devDependencies['@babel/plugin-proposal-class-properties']
    );
    await fs.writeFile(
      __dirname + '/integration/babel-plugin-autoinstall/package.json',
      originalPkg
    );
  });

  it('should produce a basic JS bundle with object rest spread support', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/object-rest-spread/object-rest-spread.js'
      )
    );

    assert.equal(b.assets.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');

    let res = output.default();
    assert.equal(res.y, 'a');
    assert.deepEqual(res.z, {y: 'a', b: 'b'});
    assert.deepEqual(res.ys, {b: 'b'});
  });

  it('should bundle node_modules on --target=browser', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'browser'
      }
    );

    await assertBundleTree(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js', 'index.js']
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should not bundle node_modules on --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'node'
      }
    );

    await assertBundleTree(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js']
    });

    await mkdirp(path.join(__dirname, '/dist/node_modules/testmodule'));
    await fs.writeFile(
      path.join(__dirname, '/dist/node_modules/testmodule/index.js'),
      'exports.a = 5;'
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it('should not bundle node_modules on --target=electron', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'electron'
      }
    );

    await assertBundleTree(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js']
    });

    await mkdirp(path.join(__dirname, '/dist/node_modules/testmodule'));
    await fs.writeFile(
      path.join(__dirname, '/dist/node_modules/testmodule/index.js'),
      'exports.a = 5;'
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it('should bundle node_modules on --target=node and --bundle-node-modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'node',
        bundleNodeModules: true
      }
    );

    await assertBundleTree(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js', 'index.js']
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should bundle node_modules on --target=electron and --bundle-node-modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require/main.js'),
      {
        target: 'electron',
        bundleNodeModules: true
      }
    );

    await assertBundleTree(b, {
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

    assert.equal(b.assets.size, 1);
    assert.equal(b.childBundles.size, 1);

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should split bundles when a dynamic import is used with --target=browser', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic/index.js'),
      {
        target: 'browser'
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'bundle-loader.js', 'bundle-url.js', 'js-loader.js'],
      childBundles: [
        {
          type: 'map'
        },
        {
          assets: ['local.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should split bundles when a dynamic import is used with --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic/index.js'),
      {
        target: 'node'
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'bundle-loader.js', 'bundle-url.js', 'js-loader.js'],
      childBundles: [
        {
          type: 'map'
        },
        {
          assets: ['local.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should support bundling workers', async function() {
    let b = await bundle(path.join(__dirname, '/integration/workers/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'common.js', 'worker-client.js', 'feature.js'],
      childBundles: [
        {
          type: 'map'
        },
        {
          assets: ['service-worker.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['shared-worker.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['worker.js', 'common.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should support bundling workers with different order', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/workers/index-alternative.js')
    );

    assertBundleTree(b, {
      name: 'index-alternative.js',
      assets: [
        'index-alternative.js',
        'common.js',
        'worker-client.js',
        'feature.js'
      ],
      childBundles: [
        {
          type: 'map'
        },
        {
          assets: ['service-worker.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['shared-worker.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['worker.js', 'common.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should support bundling service-workers', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/service-worker/a/index.js')
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.js'],
      childBundles: [
        {
          type: 'map'
        },
        {
          assets: ['worker-nested.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['worker-outside.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should support bundling workers with circular dependencies', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/worker-circular/index.js'),
      {
        sourceMaps: false
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js'],
      childBundles: [
        {
          assets: ['worker.js', 'worker-dep.js']
        }
      ]
    });
  });

  it('should dynamic import files which import raw files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-references-raw/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'bundle-loader.js', 'bundle-url.js', 'js-loader.js'],
      childBundles: [
        {
          type: 'map'
        },
        {
          assets: ['local.js', 'test.txt'],
          childBundles: [
            {
              type: 'map'
            },
            {
              assets: ['test.txt']
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should return all exports as an object when using ES modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-esm/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'bundle-loader.js', 'bundle-url.js', 'js-loader.js'],
      childBundles: [
        {
          type: 'map'
        },
        {
          assets: ['local.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let output = (await run(b)).default;
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should hoist common dependencies into a parent bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-hoist/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'common.js',
        'common-dep.js',
        'bundle-loader.js',
        'bundle-url.js',
        'js-loader.js'
      ],
      childBundles: [
        {
          assets: ['a.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          assets: ['b.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should not duplicate a module which is already in a parent bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-hoist-dup/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'common.js',
        'bundle-loader.js',
        'bundle-url.js',
        'js-loader.js'
      ],
      childBundles: [
        {
          assets: ['a.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        },
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 5);
  });

  it('should support hoisting shared modules with async imports up multiple levels', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/dynamic-hoist-deep/index.js'),
      {
        sourceMaps: false
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'c.js',
        'bundle-loader.js',
        'bundle-url.js',
        'js-loader.js'
      ],
      childBundles: [
        {
          assets: ['a.js'],
          childBundles: [
            {
              assets: ['1.js'],
              childBundles: []
            }
          ]
        },
        {
          assets: ['b.js'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.deepEqual(output, {default: {asdf: 1}});
  });

  it('should support requiring JSON files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.json'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring JSON5 files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json5/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.json5'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support importing a URL to a raw asset', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-raw/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'test.txt'],
      childBundles: [
        {
          type: 'map'
        },
        {
          type: 'txt',
          assets: ['test.txt'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert(/^\/test\.[0-9a-f]+\.txt$/.test(output()));
    assert(await fs.exists(path.join(__dirname, '/dist/', output())));
  });

  it('should minify JS in production mode', async function() {
    let b = await bundle(path.join(__dirname, '/integration/uglify/index.js'), {
      production: true
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let js = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    assert(!js.includes('local.a'));
  });

  it('should use uglify config', async function() {
    await bundle(path.join(__dirname, '/integration/uglify-config/index.js'), {
      production: true
    });

    let js = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
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

  it('should not insert environment variables on --target=node', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      target: 'node'
    });

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.env') > -1);
    assert.equal(output(), 'test:test');
  });

  it('should not insert environment variables on --target=electron', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      target: 'electron'
    });

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.env') > -1);
    assert.equal(output(), 'test:test');
  });

  it('should insert environment variables on --target=browser', async function() {
    let b = await bundle(path.join(__dirname, '/integration/env/index.js'), {
      target: 'browser'
    });

    let output = await run(b);
    assert.ok(output.toString().indexOf('process.env') === -1);
    assert.equal(output(), 'test:test');
  });

  it('should insert environment variables from a file', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/env-file/index.js')
    );

    let output = await run(b);
    assert.equal(output, 'bartest');
  });

  it('should support adding implicit dependencies', async function() {
    let b = await bundle(path.join(__dirname, '/integration/json/index.js'), {
      delegate: {
        getImplicitDependencies(asset) {
          if (asset.basename === 'index.js') {
            return [{name: '../css/index.css'}];
          }
        }
      }
    });

    await assertBundleTree(b, {
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

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.yaml'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring TOML files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/toml/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.toml'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring CoffeeScript files', async function() {
    let b = await bundle(path.join(__dirname, '/integration/coffee/index.js'));

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.coffee'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should resolve the browser field before main', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser.js')
    );

    await assertBundleTree(b, {
      name: 'browser.js',
      assets: ['browser.js', 'browser-module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-browser');
  });

  it('should not resolve the browser field for --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser.js'),
      {
        target: 'node'
      }
    );

    await assertBundleTree(b, {
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

  it('should resolve advanced browser resolution', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser-multiple.js')
    );

    await assertBundleTree(b, {
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

  it('should not resolve advanced browser resolution with --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/browser-multiple.js'),
      {
        target: 'node'
      }
    );

    await assertBundleTree(b, {
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

    await assertBundleTree(b, {
      name: 'module-field.js',
      assets: ['module-field.js', 'es6.module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it('should resolve the module field before main', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/both-fields.js')
    );

    await assertBundleTree(b, {
      name: 'both-fields.js',
      assets: ['both-fields.js', 'es6.module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it('should resolve the main field', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-entries/main-field.js')
    );

    await assertBundleTree(b, {
      name: 'main-field.js',
      assets: ['main-field.js', 'main.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-main-module');
  });

  it('should minify JSON files', async function() {
    await bundle(path.join(__dirname, '/integration/uglify-json/index.json'), {
      production: true
    });

    let json = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(json.includes('{test:"test"}'));
  });

  it('should minify JSON5 files', async function() {
    await bundle(
      path.join(__dirname, '/integration/uglify-json5/index.json5'),
      {
        production: true
      }
    );

    let json = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(json.includes('{test:"test"}'));
  });

  it('should minify YAML for production', async function() {
    let b = await bundle(path.join(__dirname, '/integration/yaml/index.js'), {
      scopeHoist: false,
      production: true
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let json = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(json.includes('{a:1,b:{c:2}}'));
  });

  it('should minify TOML for production', async function() {
    let b = await bundle(path.join(__dirname, '/integration/toml/index.js'), {
      scopeHoist: false,
      production: true
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let json = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(json.includes('{a:1,b:{c:2}}'));
  });

  it('should support compiling with babel using .babelrc config', async function() {
    await bundle(path.join(__dirname, '/integration/babel/index.js'));

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(!file.includes('function Foo'));
    assert(!file.includes('function Bar'));
  });

  it('should compile with babel with default engines if no config', async function() {
    await bundle(path.join(__dirname, '/integration/babel-default/index.js'));

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should support compiling with babel using browserlist', async function() {
    await bundle(
      path.join(__dirname, '/integration/babel-browserslist/index.js')
    );

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should support splitting babel-polyfill using browserlist', async function() {
    await bundle(path.join(__dirname, '/integration/babel-polyfill/index.js'));

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('async function'));
    assert(!file.includes('regenerator'));
  });

  it('should support compiling with babel using browserslist for different environments', async function() {
    async function testBrowserListMultipleEnv(projectBasePath) {
      // Transpiled destructuring, like r = p.prop1, o = p.prop2, a = p.prop3;
      const prodRegExp = /\S+ ?= ?\S+\.prop1,\s*?\S+ ?= ?\S+\.prop2,\s*?\S+ ?= ?\S+\.prop3;/;
      // ES6 Destructuring, like in the source;
      const devRegExp = /const ?{\s*prop1(:.+)?,\s*prop2(:.+)?,\s*prop3(:.+)?\s*} ?= ?.*/;
      let file;
      // Dev build test
      await bundle(path.join(__dirname, projectBasePath, '/index.js'));
      file = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
      assert(devRegExp.test(file) === true);
      assert(prodRegExp.test(file) === false);
      // Prod build test
      await bundle(path.join(__dirname, projectBasePath, '/index.js'), {
        minify: false,
        production: true
      });
      file = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
      assert(prodRegExp.test(file) === true);
      assert(devRegExp.test(file) === false);
    }

    await testBrowserListMultipleEnv(
      '/integration/babel-browserslist-multiple-env'
    );
    await testBrowserListMultipleEnv(
      '/integration/babel-browserslist-multiple-env-as-string'
    );
  });

  it('should not compile node_modules by default', async function() {
    await bundle(
      path.join(__dirname, '/integration/babel-node-modules/index.js')
    );

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(/class \S+ \{\}/.test(file));
    assert(file.includes('function Bar'));
  });

  it('should compile node_modules if legacy browserify options are found', async function() {
    await bundle(
      path.join(
        __dirname,
        '/integration/babel-node-modules-browserify/index.js'
      )
    );

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should compile node_modules with browserslist to app target', async function() {
    await bundle(
      path.join(
        __dirname,
        '/integration/babel-node-modules-browserslist/index.js'
      )
    );

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should compile node_modules when symlinked with a source field in package.json', async function() {
    const inputDir = path.join(__dirname, '/input');
    await mkdirp(path.join(inputDir, 'node_modules'));
    await ncp(
      path.join(path.join(__dirname, '/integration/babel-node-modules-source')),
      inputDir
    );

    // Create the symlink here to prevent cross platform and git issues
    symlinkSync(
      path.join(inputDir, 'packages/foo'),
      path.join(inputDir, 'node_modules/foo'),
      'dir'
    );

    await bundle(inputDir + '/index.js');

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should not compile node_modules with a source field in package.json when not symlinked', async function() {
    await bundle(
      path.join(
        __dirname,
        '/integration/babel-node-modules-source-unlinked/index.js'
      )
    );

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(!file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should support compiling JSX', async function() {
    await bundle(path.join(__dirname, '/integration/jsx/index.jsx'));

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('React.createElement("div"'));
  });

  it('should support compiling JSX in JS files with React dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-react/index.js'));

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('React.createElement("div"'));
  });

  it('should support compiling JSX in JS files with Preact dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-preact/index.js'));

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('h("div"'));
  });

  it('should support compiling JSX in JS files with Nerv dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-nervjs/index.js'));

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('Nerv.createElement("div"'));
  });

  it('should support compiling JSX in JS files with Hyperapp dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-hyperapp/index.js'));

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(file.includes('h("div"'));
  });

  it('should support optional dependencies in try...catch blocks', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/optional-dep/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);

    let err = new Error('Cannot find module "optional-dep"');
    err.code = 'MODULE_NOT_FOUND';

    assert.deepEqual(output, err);
  });

  it('should support excluding dependencies in falsy branches', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/falsy-dep/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'true-alternate.js', 'true-consequent.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = await run(b);
    assert.equal(output, 2);
  });

  it('should not autoinstall if resolve failed on installed module', async function() {
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

  it('should not autoinstall if resolve failed on aliased module', async function() {
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

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

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

  it('should expose variable with --browser-global', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/entry-point/index.js'),
      {
        global: 'testing'
      }
    );

    const ctx = await run(b, {module: undefined}, {require: false});
    assert.equal(ctx.window.testing(), 'Test!');
  });

  it('should set `define` to undefined so AMD checks in UMD modules do not pass', async function() {
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

  it('should not dedupe imports with different contents', async function() {
    let b = await bundle(
      path.join(__dirname, `/integration/js-different-contents/index.js`),
      {
        hmr: false // enable asset dedupe in JSPackager
      }
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello World!');
  });

  it('should not dedupe imports with same content but different absolute dependency paths', async function() {
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

  it('should dedupe imports with same content and same dependency paths', async function() {
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
    const dedupedAssets = Array.from(b.offsets.keys()).map(asset => asset.name);
    assert.equal(dedupedAssets.length, 2);
    assert(dedupedAssets.includes(path.join(rootDir, 'index.js')));
    assert(
      dedupedAssets.includes(path.join(rootDir, 'hello1.js')) ||
        dedupedAssets.includes(path.join(rootDir, 'hello2.js'))
    );
    assert(
      !(
        dedupedAssets.includes(path.join(rootDir, 'hello1.js')) &&
        dedupedAssets.includes(path.join(rootDir, 'hello2.js'))
      )
    );

    let module = await run(b);
    assert.equal(module.default, 'Hello Hello!');
  });

  it('should support importing HTML from JS async', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-async/index.js'),
      {sourceMaps: false}
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'bundle-loader.js',
        'bundle-url.js',
        'html-loader.js'
      ],
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

  it('should support importing HTML from JS async with --target=node', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-async/index.js'),
      {
        target: 'node',
        sourceMaps: false
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'bundle-loader.js',
        'bundle-url.js',
        'html-loader.js'
      ],
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

  it('should support importing HTML from JS sync', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/import-html-sync/index.js'),
      {
        sourceMaps: false
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'bundle-loader.js',
        'bundle-url.js',
        'html-loader.js'
      ],
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

    let promise = deferred();
    await run(b, {output: promise.resolve}, {require: false});
    let output = await promise;
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it('should strip away flow types of node modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/babel-strip-flow-types/index.js')
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 'hello world');

    let file = await fs.readFile(
      path.join(__dirname, '/dist/index.js'),
      'utf8'
    );
    assert(!file.includes('OptionsType'));
  });

  it('should stub require.cache', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/node_require_cache/main.js'),
      {
        target: 'node'
      }
    );

    await run(b);
  });
});
