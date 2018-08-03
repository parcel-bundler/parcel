const assert = require('assert');
const fs = require('../src/utils/fs');
const path = require('path');
const mapValidator = require('sourcemap-validator');
const {bundler, bundle, run, assertBundleTree} = require('./utils');
const SourceMap = require('../src/SourceMap');

describe('sourcemaps', function() {
  it('should create a valid sourcemap as a child of a JS bundle', async function() {
    let b = bundler(__dirname + '/integration/sourcemap/index.js');
    let bu = await b.bundle();

    await assertBundleTree(bu, {
      name: 'index.js',
      assets: ['index.js'],
      childBundles: [
        {
          name: 'index.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.map')
    )).toString();
    mapValidator(raw, map);
    let mapObject = JSON.parse(map);
    assert(
      mapObject.sourceRoot ===
        path.relative(b.options.outDir, b.options.rootDir),
      'sourceRoot should be the root of the source files, relative to the output directory.'
    );
    assert(
      await fs.exists(
        path.resolve(
          b.options.outDir,
          mapObject.sourceRoot,
          mapObject.sources[0]
        )
      ),
      'combining sourceRoot and sources object should resolve to the original file'
    );

    let output = await run(bu);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 'hello world');
  });

  it('should create a valid sourcemap as a child of a TS bundle', async function() {
    let b = await bundle(
      __dirname + '/integration/sourcemap-typescript/index.ts'
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.ts'],
      childBundles: [
        {
          name: 'index.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.map')
    )).toString();
    mapValidator(raw, map);

    let output = await run(b);
    assert.equal(typeof output.env, 'function');
    assert.equal(output.env(), process.env.NODE_ENV);
  });

  it('should create a valid sourcemap as a child of a nested TS bundle', async function() {
    let b = await bundle(
      __dirname + '/integration/sourcemap-typescript-nested/index.ts'
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.ts', 'local.ts'],
      childBundles: [
        {
          name: 'index.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.map')
    )).toString();
    mapValidator(raw, map);

    let output = await run(b);
    assert.equal(typeof output.env, 'function');
    assert.equal(output.env(), process.env.NODE_ENV);
  });

  it('should create a valid sourcemap for a js file with requires', async function() {
    let b = await bundle(__dirname + '/integration/sourcemap-nested/index.js');

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.js', 'util.js'],
      childBundles: [
        {
          name: 'index.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.map')
    )).toString();
    mapValidator(raw, map);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 14);
  });

  it('should create a valid sourcemap for a minified js bundle with requires', async function() {
    let b = await bundle(
      __dirname + '/integration/sourcemap-nested-minified/index.js',
      {
        minify: true
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.js', 'util.js'],
      childBundles: [
        {
          name: 'index.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.map')
    )).toString();
    mapValidator(raw, map);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 14);
  });

  it('should create a valid sourcemap reference for a child bundle', async function() {
    let b = await bundle(
      __dirname + '/integration/sourcemap-reference/index.html'
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'js',
          assets: ['index.js', 'data.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    let jsOutput = (await fs.readFile(
      Array.from(b.childBundles)[0].name
    )).toString();

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22)
    );
    assert(
      await fs.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist'
    );

    let map = (await fs.readFile(path.join(sourcemapReference))).toString();
    mapValidator(jsOutput, map);
  });

  it('should load existing sourcemaps of libraries', async function() {
    let b = await bundle(
      __dirname + '/integration/sourcemap-existing/index.js'
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'sum.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let jsOutput = await fs.readFile(b.name, 'utf8');

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22)
    );

    assert(
      await fs.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist'
    );

    let map = await fs.readFile(path.join(sourcemapReference), 'utf8');
    assert(
      map.indexOf('module.exports = (a, b) => a + b') > -1,
      'Sourcemap should contain the existing sourcemap'
    );
    mapValidator(jsOutput, map);
  });

  it('should load inline sourcemaps of libraries', async function() {
    let b = await bundle(__dirname + '/integration/sourcemap-inline/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'sum.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let jsOutput = await fs.readFile(b.name, 'utf8');

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22)
    );

    assert(
      await fs.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist'
    );

    let map = await fs.readFile(path.join(sourcemapReference), 'utf8');
    assert(
      map.indexOf('module.exports = (a, b) => a + b') > -1,
      'Sourcemap should contain the existing sourcemap'
    );
    mapValidator(jsOutput, map);
  });

  it('should load referenced contents of sourcemaps', async function() {
    let b = await bundle(
      __dirname + '/integration/sourcemap-external-contents/index.js'
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'sum.js'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let jsOutput = await fs.readFile(b.name, 'utf8');

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22)
    );

    assert(
      await fs.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist'
    );

    let map = await fs.readFile(path.join(sourcemapReference), 'utf8');
    assert(
      map.indexOf('module.exports = (a, b) => a + b') > -1,
      'Sourcemap should contain the existing sourcemap'
    );
    mapValidator(jsOutput, map);
  });

  it('should purify mappings properly', async function() {
    let mappings = [
      {
        source: 'index.js',
        name: 'A',
        original: {
          line: 0,
          column: 0
        },
        generated: {
          line: 0,
          column: 0
        }
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: null,
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: null,
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 0,
          column: 0
        },
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 1,
          column: 0
        },
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 1,
          column: 0
        },
        source: 'index.js',
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 0,
          column: 0
        },
        source: 'index.js',
        name: null
      },
      {
        source: 'index.js',
        name: 'A',
        original: {
          line: 1,
          column: 18
        },
        generated: {
          line: 4,
          column: 187
        }
      }
    ];

    let expectedResult = [
      {
        generated: {
          line: 1,
          column: 0
        },
        original: null,
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: null,
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 1,
          column: 0
        },
        source: 'index.js',
        name: null
      },
      {
        source: 'index.js',
        name: 'A',
        original: {
          line: 1,
          column: 18
        },
        generated: {
          line: 4,
          column: 187
        }
      }
    ];

    let sourcemap = new SourceMap(mappings, {});

    assert.deepEqual(sourcemap.mappings, expectedResult);
  });

  it('should be able to handle null mappings properly', async function() {
    let mappings = [
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 1,
          column: 0
        },
        source: 'input.js',
        name: 'console'
      },
      {
        generated: {
          line: 1,
          column: 7
        },
        original: null,
        source: null,
        name: null
      }
    ];

    let sources = {
      'input.js': 'console.log("hello world!");'
    };

    let sourcemap = new SourceMap(mappings, sources);

    assert.equal(sourcemap.mappings.length, 2);
    assert.deepEqual(sourcemap.mappings, mappings);

    let mapString = sourcemap.stringify('index.map', '/');

    let combinedSourcemap = new SourceMap(mappings, sources);

    await combinedSourcemap.addMap(mapString);

    let newMapString = combinedSourcemap.stringify('index.map', '/');

    assert.equal(mapString, newMapString);

    let newSourcemap = new SourceMap([], {});

    await newSourcemap.addMap(sourcemap);

    assert.deepEqual(newSourcemap.mappings, mappings);

    newSourcemap = new SourceMap([], {});

    await newSourcemap.addMap(mapString);

    assert.deepEqual(newSourcemap.mappings, mappings);
  });
});
