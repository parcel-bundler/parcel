const assert = require('assert');
const path = require('path');
const os = require('os');
const SourceMap = require('parcel-bundler/src/SourceMap');
const {
  bundle,
  run,
  assertBundleTree,
  inputFS,
  outputFS
} = require('@parcel/test-utils');
const {loadSourceMapUrl} = require('@parcel/utils');

function indexToLineCol(str, index) {
  let beforeIndex = str.slice(0, index);
  return {
    line: beforeIndex.split('\n').length,
    column: index - beforeIndex.lastIndexOf('\n') - 1
  };
}

function checkSourceMapping({
  map,
  source,
  generated,
  str,
  generatedStr = str,
  sourcePath,
  msg = ''
}) {
  assert(
    generated.indexOf(generatedStr) !== -1,
    "'" + generatedStr + "' not in generated code"
  );
  assert(source.indexOf(str) !== -1, "'" + str + "' not in source code");

  let generatedPosition = indexToLineCol(
    generated,
    generated.indexOf(generatedStr)
  );
  let sourcePosition = indexToLineCol(source, source.indexOf(str));

  let index = map.findClosestGenerated(
    generatedPosition.line,
    generatedPosition.column
  );

  let mapping = map.mappings[index];
  assert(mapping, "no mapping for '" + str + "'" + msg);

  let generatedDiff = {
    line: generatedPosition.line - mapping.generated.line,
    column: generatedPosition.column - mapping.generated.column
  };

  let computedSourcePosition = {
    line: mapping.original.line + generatedDiff.line,
    column: mapping.original.column + generatedDiff.column
  };

  assert.deepStrictEqual(
    {
      line: computedSourcePosition.line,
      column: computedSourcePosition.column,
      source: mapping.source
    },
    {
      line: sourcePosition.line,
      column: sourcePosition.column,
      source: sourcePath
    },
    "mapping '" + str + "' appears incorrect: " + msg
  );
}

describe('sourcemaps', function() {
  it('Should create a basic browser sourcemap', async function() {
    let sourceFilename = path.join(
      __dirname,
      '/integration/sourcemap/index.js'
    );
    await bundle(sourceFilename);

    let distDir = path.join(__dirname, '/integration/sourcemap/dist/');

    let filename = path.join(distDir, 'index.js');
    let raw = await outputFS.readFile(filename, 'utf8');
    let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
    if (!mapUrlData) {
      throw new Error('Could not load map');
    }
    let map = mapUrlData.map;

    assert.equal(
      map.sourceRoot,
      '/__parcel_source_root/',
      'sourceRoot should be the project root mounted to dev server.'
    );

    let sourceMap = await new SourceMap().addMap(map);
    let input = await inputFS.readFile(sourceFilename, 'utf8');
    let sourcePath =
      'packages/core/integration-tests/test/integration/sourcemap/index.js';
    assert.equal(Object.keys(sourceMap.sources).length, 1);
    assert.strictEqual(sourceMap.sources[sourcePath], null);

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'function helloWorld',
      sourcePath
    });

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'module.exports = helloWorld;',
      sourcePath
    });

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: '"hello world"',
      sourcePath
    });
  });

  it('Should create a basic node sourcemap', async function() {
    let sourceFilename = path.join(
      __dirname,
      '/integration/sourcemap-node/index.js'
    );
    await bundle(sourceFilename);

    let distDir = path.join(__dirname, '/integration/sourcemap-node/dist/');
    let filename = path.join(distDir, 'index.js');
    let raw = await outputFS.readFile(filename, 'utf8');
    let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
    if (!mapUrlData) {
      throw new Error('Could not load map');
    }

    let map = mapUrlData.map;
    let sourceRoot = map.sourceRoot;
    assert.equal(
      sourceRoot,
      '../../../../../../../',
      'sourceRoot should be the root of the source files, relative to the output directory.'
    );

    let sourceMap = await new SourceMap().addMap(map);
    let input = await inputFS.readFile(sourceFilename, 'utf8');
    let sourcePath =
      'packages/core/integration-tests/test/integration/sourcemap-node/index.js';
    assert.equal(Object.keys(sourceMap.sources).length, 1);
    assert.strictEqual(sourceMap.sources[sourcePath], null);
    assert(
      await inputFS.exists(path.resolve(distDir + sourceRoot + sourcePath)),
      'combining sourceRoot and sources object should resolve to the original file'
    );

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'function helloWorld',
      sourcePath
    });

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'module.exports = helloWorld;',
      sourcePath
    });

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: '"hello world"',
      sourcePath
    });
  });

  it('should create a valid sourcemap for a js file with requires', async function() {
    let sourceDir = path.join(__dirname, '/integration/sourcemap-nested/');
    let sourceFilename = path.join(sourceDir, '/index.js');
    await bundle(sourceFilename);

    let distDir = path.join(__dirname, '/integration/sourcemap-nested/dist/');
    let filename = path.join(distDir, 'index.js');
    let raw = await outputFS.readFile(filename, 'utf8');
    let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
    if (!mapUrlData) {
      throw new Error('Could not load map');
    }

    let map = mapUrlData.map;
    let sourceRoot = map.sourceRoot;
    assert.equal(
      sourceRoot,
      '../../../../../../../',
      'sourceRoot should be the root of the source files, relative to the output directory.'
    );

    let sourceMap = await new SourceMap().addMap(map);
    assert.equal(Object.keys(sourceMap.sources).length, 3);

    for (let source of Object.keys(sourceMap.sources)) {
      assert.strictEqual(sourceMap.sources[source], null);
      assert(
        await inputFS.exists(path.resolve(distDir + sourceRoot + source)),
        'combining sourceRoot and sources object should resolve to the original file'
      );
    }

    let inputs = [
      await inputFS.readFile(sourceFilename, 'utf8'),
      await inputFS.readFile(path.join(sourceDir, 'local.js'), 'utf8'),
      await inputFS.readFile(path.join(sourceDir, 'utils/util.js'), 'utf8')
    ];

    checkSourceMapping({
      map: sourceMap,
      source: inputs[0],
      generated: raw,
      str: 'const local',
      sourcePath:
        'packages/core/integration-tests/test/integration/sourcemap-nested/index.js'
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[0],
      generated: raw,
      str: 'local.a',
      sourcePath:
        'packages/core/integration-tests/test/integration/sourcemap-nested/index.js'
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[1],
      generated: raw,
      str: 'exports.a',
      sourcePath:
        'packages/core/integration-tests/test/integration/sourcemap-nested/local.js'
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[2],
      generated: raw,
      str: 'exports.count = function(a, b) {',
      generatedStr: 'exports.count = function (a, b) {',
      sourcePath:
        'packages/core/integration-tests/test/integration/sourcemap-nested/utils/util.js'
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[2],
      generated: raw,
      str: 'return a + b',
      sourcePath:
        'packages/core/integration-tests/test/integration/sourcemap-nested/utils/util.js'
    });
  });

  it.skip('should create a valid sourcemap as a child of a TS bundle', async function() {
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

    // let raw = await outputFS.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    let map = await outputFS.readFile(
      path.join(__dirname, '/dist/index.js.map'),
      'utf8'
    );
    assert.equal(JSON.parse(map).sources.length, 1);

    let output = await run(b);
    assert.equal(typeof output.env, 'function');
    assert.equal(output.env(), process.env.NODE_ENV);
  });

  it.skip('should create a valid sourcemap as a child of a nested TS bundle', async function() {
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

    // let raw = await outputFS.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    let map = await outputFS.readFile(
      path.join(__dirname, '/dist/index.js.map'),
      'utf8'
    );
    assert.equal(JSON.parse(map).sources.length, 2);

    let output = await run(b);
    assert.equal(typeof output.env, 'function');
    assert.equal(output.env(), process.env.NODE_ENV);
  });

  it.skip('should create a valid sourcemap for a minified js bundle with requires', async function() {
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

    // let raw = await outputFS.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    let map = await outputFS.readFile(
      path.join(__dirname, '/dist/index.js.map'),
      'utf8'
    );
    assert.equal(JSON.parse(map).sources.length, 3);

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 14);
  });

  it.skip('should load existing sourcemaps of libraries', async function() {
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

    let jsOutput = await outputFS.readFile(b.name, 'utf8');

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22)
    );

    assert(
      await outputFS.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist'
    );

    let map = await outputFS.readFile(path.join(sourcemapReference), 'utf8');
    assert(
      map.indexOf('module.exports = (a, b) => a + b') > -1,
      'Sourcemap should contain the existing sourcemap'
    );
  });

  it.skip('should load inline sourcemaps of libraries', async function() {
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

    let jsOutput = await outputFS.readFile(b.name, 'utf8');

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22)
    );

    assert(
      await outputFS.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist'
    );

    let map = await outputFS.readFile(path.join(sourcemapReference), 'utf8');
    assert(
      map.indexOf('module.exports = (a, b) => a + b') > -1,
      'Sourcemap should contain the existing sourcemap'
    );
  });

  it.skip('should load referenced contents of sourcemaps', async function() {
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

    let jsOutput = await outputFS.readFile(b.name, 'utf8');

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22)
    );

    assert(
      await outputFS.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist'
    );

    let map = await outputFS.readFile(path.join(sourcemapReference), 'utf8');
    assert(
      map.indexOf('module.exports = (a, b) => a + b') > -1,
      'Sourcemap should contain the existing sourcemap'
    );
  });

  it.skip('should create a valid sourcemap as a child of a CSS bundle', async function() {
    async function test(minify) {
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

      let input = await inputFS.readFile(
        path.join(__dirname, '/integration/sourcemap-css/style.css'),
        'utf8'
      );
      let raw = await outputFS.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await outputFS.readFile(
          path.join(__dirname, '/dist/style.css.map'),
          'utf8'
        )
      );

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));
      assert.equal(
        map.sourceRoot,
        path.normalize('../integration/sourcemap-css')
      );

      let sourceMap = await new SourceMap().addMap(map);
      assert.equal(Object.keys(sourceMap.sources).length, 1);
      assert.equal(sourceMap.sources['style.css'], input);

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'body',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'background-color',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }

    await test(false);
    await test(true);
  });

  it.skip('should create a valid sourcemap for a CSS bundle with imports', async function() {
    async function test(minify) {
      let b = await bundle(
        path.join(__dirname, '/integration/sourcemap-css-import/style.css'),
        {minify}
      );

      await assertBundleTree(b, {
        name: 'style.css',
        assets: ['style.css', 'other-style.css', 'another-style.css'],
        childBundles: [
          {
            name: 'style.css.map',
            type: 'map'
          }
        ]
      });

      let style = await inputFS.readFile(
        path.join(__dirname, '/integration/sourcemap-css-import/style.css'),
        'utf8'
      );
      let otherStyle = await inputFS.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-import/other-style.css'
        ),
        'utf8'
      );
      let anotherStyle = await inputFS.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-import/another-style.css'
        ),
        'utf8'
      );
      let raw = await outputFS.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await outputFS.readFile(
          path.join(__dirname, '/dist/style.css.map'),
          'utf8'
        )
      );

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));
      assert.equal(
        map.sourceRoot,
        path.normalize('../integration/sourcemap-css-import')
      );

      let sourceMap = await new SourceMap().addMap(map);
      assert.equal(Object.keys(sourceMap.sources).length, 3);
      assert.equal(sourceMap.sources['style.css'], style);
      assert.equal(sourceMap.sources['other-style.css'], otherStyle);
      assert.equal(sourceMap.sources['another-style.css'], anotherStyle);

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'body',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'background-color',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: otherStyle,
        generated: raw,
        str: 'div',
        sourcePath: 'other-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: otherStyle,
        generated: raw,
        str: 'width',
        sourcePath: 'other-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: anotherStyle,
        generated: raw,
        str: 'main',
        sourcePath: 'another-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: anotherStyle,
        generated: raw,
        str: 'font-family',
        sourcePath: 'another-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }

    await test(false);
    await test(true);
  });

  it.skip('should create a valid sourcemap for a SASS asset', async function() {
    async function test(minify) {
      let b = await bundle(
        path.join(__dirname, '/integration/sourcemap-sass/style.scss'),
        {minify}
      );

      await assertBundleTree(b, {
        name: 'style.css',
        assets: ['style.scss'],
        childBundles: [
          {
            name: 'style.css.map',
            type: 'map'
          }
        ]
      });

      let input = await inputFS.readFile(
        path.join(__dirname, '/integration/sourcemap-sass/style.scss'),
        'utf8'
      );
      let raw = await inputFS.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await outputFS.readFile(
          path.join(__dirname, '/dist/style.css.map'),
          'utf8'
        )
      );

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));
      assert.equal(
        map.sourceRoot,
        path.normalize('../integration/sourcemap-sass')
      );

      let sourceMap = await new SourceMap().addMap(map);
      assert.equal(Object.keys(sourceMap.sources).length, 1);
      assert.equal(sourceMap.sources['style.scss'], input);

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'body',
        sourcePath: 'style.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'color',
        sourcePath: 'style.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }

    await test(false);
    await test(true);
  });

  it.skip('should create a valid sourcemap when for a CSS asset importing SASS', async function() {
    async function test(minify) {
      let b = await bundle(
        path.join(__dirname, '/integration/sourcemap-sass-imported/style.css'),
        {minify}
      );

      await assertBundleTree(b, {
        name: 'style.css',
        assets: ['style.css', 'other.scss'],
        childBundles: [
          {
            name: 'style.css.map',
            type: 'map'
          }
        ]
      });

      let style = await inputFS.readFile(
        path.join(__dirname, '/integration/sourcemap-sass-imported/style.css'),
        'utf8'
      );
      let other = await inputFS.readFile(
        path.join(__dirname, '/integration/sourcemap-sass-imported/other.scss'),
        'utf8'
      );
      let raw = await outputFS.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await outputFS.readFile(
          path.join(__dirname, '/dist/style.css.map'),
          'utf8'
        )
      );

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));
      assert.equal(
        map.sourceRoot,
        path.normalize('../integration/sourcemap-sass-imported')
      );

      let sourceMap = await new SourceMap().addMap(map);
      assert.equal(Object.keys(sourceMap.sources).length, 2);
      assert.equal(sourceMap.sources['style.css'], style);
      assert.equal(sourceMap.sources['other.scss'], other);

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'body',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'color',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: other,
        generated: raw,
        str: 'div',
        sourcePath: 'other.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: other,
        generated: raw,
        str: 'font-family',
        sourcePath: 'other.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }
    await test(false);
    await test(true);
  });

  it.skip('should create a valid sourcemap for a LESS asset', async function() {
    async function test(minify) {
      let b = await bundle(
        path.join(__dirname, '/integration/sourcemap-less/style.less'),
        {minify}
      );

      await assertBundleTree(b, {
        name: 'style.css',
        assets: ['style.less'],
        childBundles: [
          {
            name: 'style.css.map',
            type: 'map'
          }
        ]
      });

      let input = await inputFS.readFile(
        path.join(__dirname, '/integration/sourcemap-less/style.less'),
        'utf8'
      );
      let raw = await inputFS.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await outputFS.readFile(
          path.join(__dirname, '/dist/style.css.map'),
          'utf8'
        )
      );

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));
      assert.equal(
        map.sourceRoot,
        path.normalize('../integration/sourcemap-less')
      );

      let sourceMap = await new SourceMap().addMap(map);
      assert.equal(Object.keys(sourceMap.sources).length, 1);
      assert.equal(
        sourceMap.sources['style.less'],
        input.replace(new RegExp(os.EOL, 'g'), '\n')
      );

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'div',
        sourcePath: 'style.less',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'width',
        sourcePath: 'style.less',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }
    await test(false);
    await test(true);
  });

  it.skip('should load existing sourcemaps for CSS files', async function() {
    async function test(minify) {
      let b = await bundle(
        path.join(__dirname, '/integration/sourcemap-css-existing/style.css'),
        {minify}
      );

      await assertBundleTree(b, {
        name: 'style.css',
        assets: ['style.css', 'library.css'],
        childBundles: [
          {
            name: 'style.css.map',
            type: 'map'
          }
        ]
      });

      let style = await inputFS.readFile(
        path.join(__dirname, '/integration/sourcemap-css-existing/style.css'),
        'utf8'
      );
      let library = await inputFS.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-existing/test/library.raw.scss'
        ),
        'utf8'
      );
      let raw = await outputFS.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await outputFS.readFile(
          path.join(__dirname, '/dist/style.css.map'),
          'utf8'
        )
      );

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));
      assert.equal(
        map.sourceRoot,
        path.normalize('../integration/sourcemap-css-existing')
      );

      let sourceMap = await new SourceMap().addMap(map);
      assert.equal(Object.keys(sourceMap.sources).length, 2);
      assert.equal(sourceMap.sources['style.css'], style);
      assert.equal(
        sourceMap.sources[path.normalize('test/library.scss')],
        library.replace(new RegExp(os.EOL, 'g'), '\n')
      );

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'main',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'display',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: library,
        generated: raw,
        str: 'body',
        sourcePath: path.normalize('test/library.scss'),
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: library,
        generated: raw,
        str: 'div',
        generatedStr: 'body div',
        sourcePath: path.normalize('test/library.scss'),
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: library,
        generated: raw,
        str: 'background-color',
        sourcePath: path.normalize('test/library.scss'),
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }
    await test(false);
    await test(true);
  });
});
