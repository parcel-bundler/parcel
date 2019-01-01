const assert = require('assert');
const fs = require('@parcel/fs');
const path = require('path');
const mapValidator = require('sourcemap-validator');
const {SourceMapConsumer} = require('source-map');
const {bundler, bundle, run, assertBundleTree} = require('./utils');

function indexToLineCol(str, index) {
  const beforeIndex = str.slice(0, index);
  return {
    line: beforeIndex.split('\n').length,
    column: index - beforeIndex.lastIndexOf('\n') - 1
  };
}

describe('sourcemaps', function() {
  it('should create a valid sourcemap as a child of a JS bundle', async function() {
    let b = bundler(path.join(__dirname, '/integration/sourcemap/index.js'));
    let bu = await b.bundle();

    await assertBundleTree(bu, {
      name: 'index.js',
      assets: ['index.js'],
      childBundles: [
        {
          name: 'index.js.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.js.map')
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
      path.join(__dirname, '/integration/sourcemap-typescript/index.ts')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.ts'],
      childBundles: [
        {
          name: 'index.js.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.js.map')
    )).toString();
    mapValidator(raw, map);

    let output = await run(b);
    assert.equal(typeof output.env, 'function');
    assert.equal(output.env(), process.env.NODE_ENV);
  });

  it('should create a valid sourcemap as a child of a nested TS bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-typescript-nested/index.ts')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.ts', 'local.ts'],
      childBundles: [
        {
          name: 'index.js.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.js.map')
    )).toString();
    mapValidator(raw, map);

    let output = await run(b);
    assert.equal(typeof output.env, 'function');
    assert.equal(output.env(), process.env.NODE_ENV);
  });

  it('should create a valid sourcemap for a js file with requires', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-nested/index.js')
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.js', 'util.js'],
      childBundles: [
        {
          name: 'index.js.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.js.map')
    )).toString();
    mapValidator(raw, map);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 14);
  });

  it('should create a valid sourcemap for a minified js bundle with requires', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-nested-minified/index.js'),
      {
        minify: true
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.js', 'util.js'],
      childBundles: [
        {
          name: 'index.js.map',
          type: 'map'
        }
      ]
    });

    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/index.js')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/index.js.map')
    )).toString();
    mapValidator(raw, map);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 14);
  });

  it('should create a valid sourcemap reference for a child bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-reference/index.html')
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
      path.join(__dirname, '/integration/sourcemap-existing/index.js')
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
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-inline/index.js')
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

  it('should load referenced contents of sourcemaps', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-external-contents/index.js')
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

  it('should create a valid sourcemap as a child of a CSS bundle', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-css/style.css'),
      {minify: true}
    );

    await assertBundleTree(b, {
      name: 'style.css',
      assets: ['style.css'],
      childBundles: [
        {
          name: 'style.css.map',
          type: 'map'
        }
      ]
    });

    let input = (await fs.readFile(
      path.join(__dirname, '/integration/sourcemap-css/style.css')
    )).toString();
    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/style.css')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/style.css.map')
    )).toString();

    assert(raw.includes('/*# sourceMappingURL=/style.css.map*/'));

    let consumer = await new SourceMapConsumer(map);

    assert.deepStrictEqual(
      consumer.originalPositionFor(indexToLineCol(raw, raw.indexOf('body'))),
      {
        source: '../integration/sourcemap-css/style.css',
        name: null,
        line: indexToLineCol(input, input.indexOf('body')).line,
        column: indexToLineCol(input, input.indexOf('body')).column
      },
      "map 'body'"
    );

    // assert.deepStrictEqual(
    //   consumer.originalPositionFor(indexToLineCol(raw, raw.indexOf('{'))),
    //   {
    //     source: '../integration/sourcemap-css/style.css',
    //     name: null,
    //     ...indexToLineCol(input, input.indexOf('{'))
    //   },
    //   "map '{'"
    // );

    assert.deepStrictEqual(
      consumer.originalPositionFor(
        indexToLineCol(raw, raw.indexOf('background-color'))
      ),
      {
        source: '../integration/sourcemap-css/style.css',
        name: null,
        line: indexToLineCol(input, input.indexOf('background-color')).line,
        column: indexToLineCol(input, input.indexOf('background-color')).column
      },
      "map 'background-color'"
    );

    // assert.deepStrictEqual(
    //   consumer.originalPositionFor(indexToLineCol(raw, raw.indexOf('}'))),
    //   {
    //     source: '../integration/sourcemap-css/style.css',
    //     name: null,
    //     ...indexToLineCol(input, input.indexOf('}'))
    //   },
    //   "map '}'"
    // );
  });

  it('should create a valid sourcemap for a CSS bundle with imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-css-import/style.css'),
      {minify: true}
    );

    await assertBundleTree(b, {
      name: 'style.css',
      assets: ['style.css', 'other-style.css'],
      childBundles: [
        {
          name: 'style.css.map',
          type: 'map'
        }
      ]
    });

    let style = (await fs.readFile(
      path.join(__dirname, '/integration/sourcemap-css-import/style.css')
    )).toString();
    let otherStyle = (await fs.readFile(
      path.join(__dirname, '/integration/sourcemap-css-import/other-style.css')
    )).toString();
    let raw = (await fs.readFile(
      path.join(__dirname, '/dist/style.css')
    )).toString();
    let map = (await fs.readFile(
      path.join(__dirname, '/dist/style.css.map')
    )).toString();

    assert(raw.includes('/*# sourceMappingURL=/style.css.map*/'));

    let consumer = await new SourceMapConsumer(map);

    // assert.deepStrictEqual(
    //   consumer.originalPositionFor(indexToLineCol(raw, raw.indexOf('body'))),
    //   {
    //     source: '../integration/sourcemap-css-import/style.css',
    //     name: null,
    //     ...indexToLineCol(style, style.indexOf('body'))
    //   },
    //   "map 'body'"
    // );

    assert.deepStrictEqual(
      consumer.originalPositionFor(
        indexToLineCol(raw, raw.indexOf('background-color'))
      ),
      {
        source: '../integration/sourcemap-css-import/style.css',
        name: null,
        line: indexToLineCol(style, style.indexOf('background-color')).line,
        column: indexToLineCol(style, style.indexOf('background-color')).column
      },
      "map 'background-color'"
    );

    // assert.deepStrictEqual(
    //   consumer.originalPositionFor({line: 1, column: raw.indexOf('div')}),
    //   {
    //     source: '../integration/sourcemap-css-import/other-style.css',
    //     name: null,
    //     ...indexToLineCol(otherStyle, otherStyle.indexOf('div'))
    //   },
    //   "map 'div'"
    // );

    assert.deepStrictEqual(
      consumer.originalPositionFor({line: 1, column: raw.indexOf('width')}),
      {
        source: '../integration/sourcemap-css-import/other-style.css',
        name: null,
        line: indexToLineCol(otherStyle, otherStyle.indexOf('width')).line,
        column: indexToLineCol(otherStyle, otherStyle.indexOf('width')).column
      },
      "map 'width'"
    );
  });
});
