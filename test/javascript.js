const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {bundle, run, assertBundleTree} = require('./utils');
const {mkdirp} = require('../src/utils/fs');

describe('javascript', function() {
  it('should produce a basic JS bundle with CommonJS requires', async function() {
    let b = await bundle(__dirname + '/integration/commonjs/index.js');

    assert.equal(b.assets.size, 8);
    assert.equal(b.childBundles.size, 1);

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should produce a basic JS bundle with ES6 imports', async function() {
    let b = await bundle(__dirname + '/integration/es6/index.js');

    assert.equal(b.assets.size, 8);
    assert.equal(b.childBundles.size, 1);

    let output = run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should bundle node_modules on --target=browser', async function() {
    let b = await bundle(__dirname + '/integration/node_require/main.js', {
      target: 'browser'
    });

    assertBundleTree(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js', 'index.js']
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should not bundle node_modules on --target=node', async function() {
    let b = await bundle(__dirname + '/integration/node_require/main.js', {
      target: 'node'
    });

    assertBundleTree(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js']
    });

    await mkdirp(__dirname + '/dist/node_modules/testmodule');
    fs.writeFileSync(
      __dirname + '/dist/node_modules/testmodule/index.js',
      'exports.a = 5;'
    );

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it('should not bundle node_modules on --target=electron', async function() {
    let b = await bundle(__dirname + '/integration/node_require/main.js', {
      target: 'electron'
    });

    assertBundleTree(b, {
      name: 'main.js',
      assets: ['main.js', 'local.js']
    });

    await mkdirp(__dirname + '/dist/node_modules/testmodule');
    fs.writeFileSync(
      __dirname + '/dist/node_modules/testmodule/index.js',
      'exports.a = 5;'
    );

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 7);
  });

  it('should produce a JS bundle with default exports and no imports', async function() {
    let b = await bundle(__dirname + '/integration/es6-default-only/index.js');

    assert.equal(b.assets.size, 1);
    assert.equal(b.childBundles.size, 1);

    let output = run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);
  });

  it('should split bundles when a dynamic import is used', async function() {
    let b = await bundle(__dirname + '/integration/dynamic/index.js');

    assertBundleTree(b, {
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

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should support bundling workers', async function() {
    let b = await bundle(__dirname + '/integration/workers/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js'],
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
          assets: ['worker.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should dynamic import files which import raw files', async function() {
    let b = await bundle(
      __dirname + '/integration/dynamic-references-raw/index.js'
    );

    assertBundleTree(b, {
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

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should return all exports as an object when using ES modules', async function() {
    let b = await bundle(__dirname + '/integration/dynamic-esm/index.js');

    assertBundleTree(b, {
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

    let output = run(b).default;
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 3);
  });

  it('should hoist common dependencies into a parent bundle', async function() {
    let b = await bundle(__dirname + '/integration/dynamic-hoist/index.js');

    assertBundleTree(b, {
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

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(await output(), 7);
  });

  it('should support requiring JSON files', async function() {
    let b = await bundle(__dirname + '/integration/json/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.json'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring JSON5 files', async function() {
    let b = await bundle(__dirname + '/integration/json5/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.json5'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support importing a URL to a raw asset', async function() {
    let b = await bundle(__dirname + '/integration/import-raw/index.js');

    assertBundleTree(b, {
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

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert(/^\/dist\/[0-9a-f]+\.txt$/.test(output()));
    assert(fs.existsSync(__dirname + output()));
  });

  it('should minify JS in production mode', async function() {
    let b = await bundle(__dirname + '/integration/uglify/index.js', {
      production: true
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);

    let js = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(!js.includes('local.a'));
  });

  it('should use uglify config', async function() {
    await bundle(__dirname + '/integration/uglify-config/index.js', {
      production: true
    });

    let js = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(!js.includes('console.log'));
    assert(!js.includes('// This is a comment'));
  });

  it('should insert global variables when needed', async function() {
    let b = await bundle(__dirname + '/integration/globals/index.js');

    let output = run(b);
    assert.deepEqual(output(), {
      dir: path.join(__dirname, '/integration/globals'),
      file: path.join(__dirname, '/integration/globals/index.js'),
      buf: new Buffer('browser').toString('base64'),
      global: true
    });
  });

  it('should insert environment variables', async function() {
    let b = await bundle(__dirname + '/integration/env/index.js');

    let output = run(b);
    assert.equal(output(), 'test:test');
  });

  it('should insert environment variables from a file', async function() {
    let b = await bundle(__dirname + '/integration/env-file/index.js');

    let output = run(b);
    assert.equal(output, 'bartest');
  });

  it('should support adding implicit dependencies', async function() {
    let b = await bundle(__dirname + '/integration/json/index.js', {
      delegate: {
        getImplicitDependencies(asset) {
          if (asset.basename === 'index.js') {
            return [{name: __dirname + '/integration/css/index.css'}];
          }
        }
      }
    });

    assertBundleTree(b, {
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

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring YAML files', async function() {
    let b = await bundle(__dirname + '/integration/yaml/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.yaml'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should support requiring CoffeeScript files', async function() {
    let b = await bundle(__dirname + '/integration/coffee/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.coffee'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 3);
  });

  it('should resolve the browser field before main', async function() {
    let b = await bundle(__dirname + '/integration/resolve-entries/browser.js');

    assertBundleTree(b, {
      name: 'browser.js',
      assets: ['browser.js', 'browser-module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-browser');
  });

  it('should resolve advanced browser resolution', async function() {
    let b = await bundle(
      __dirname + '/integration/resolve-entries/browser-multiple.js'
    );

    assertBundleTree(b, {
      name: 'browser-multiple.js',
      assets: ['browser-multiple.js', 'projected-module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-browser-multiple');
  });

  it('should resolve the module field before main', async function() {
    let b = await bundle(
      __dirname + '/integration/resolve-entries/module-field.js'
    );

    assertBundleTree(b, {
      name: 'module-field.js',
      assets: ['module-field.js', 'es6.module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it('should resolve the jsnext:main field before main', async function() {
    let b = await bundle(
      __dirname + '/integration/resolve-entries/jsnext-field.js'
    );

    assertBundleTree(b, {
      name: 'jsnext-field.js',
      assets: ['jsnext-field.js', 'jsnext.module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-jsnext-module');
  });

  it('should resolve the module field before jsnext:main', async function() {
    let b = await bundle(
      __dirname + '/integration/resolve-entries/both-fields.js'
    );

    assertBundleTree(b, {
      name: 'both-fields.js',
      assets: ['both-fields.js', 'es6.module.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-es6-module');
  });

  it('should resolve the main field', async function() {
    let b = await bundle(
      __dirname + '/integration/resolve-entries/main-field.js'
    );

    assertBundleTree(b, {
      name: 'main-field.js',
      assets: ['main-field.js', 'main.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let output = run(b);

    assert.equal(typeof output.test, 'function');
    assert.equal(output.test(), 'pkg-main-module');
  });

  it('should minify JSON files', async function() {
    await bundle(__dirname + '/integration/uglify-json/index.json', {
      production: true
    });

    let json = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(json.includes('{test:"test"}'));
  });

  it('should minify JSON5 files', async function() {
    await bundle(__dirname + '/integration/uglify-json5/index.json5', {
      production: true
    });

    let json = fs.readFileSync(__dirname + '/dist/index.js', 'utf8');
    assert(json.includes('{test:"test"}'));
  });
});
