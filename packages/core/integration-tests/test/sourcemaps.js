const assert = require('assert');
const fs = require('@parcel/fs');
const path = require('path');
const mapValidator = require('sourcemap-validator');
const SourceMap = require('parcel-bundler/src/SourceMap');
const {bundler, bundle, run, assertBundleTree} = require('./utils');

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
    "map '" + str + "'" + msg
  );
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

      let input = (await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-css/style.css')
      )).toString();
      let raw = (await fs.readFile(
        path.join(__dirname, '/dist/style.css')
      )).toString();
      let map = (await fs.readFile(
        path.join(__dirname, '/dist/style.css.map')
      )).toString();

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));

      assert(map.includes('background-color:'));

      let sourceMap = await new SourceMap().addMap(JSON.parse(map));

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'body',
        sourcePath: '../integration/sourcemap-css/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'background-color',
        sourcePath: '../integration/sourcemap-css/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }

    await test(false);
    await test(true);
  });

  it('should create a valid sourcemap for a CSS bundle with imports', async function() {
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

      let style = (await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-css-import/style.css')
      )).toString();
      let otherStyle = (await fs.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-import/other-style.css'
        )
      )).toString();
      let anotherStyle = (await fs.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-import/another-style.css'
        )
      )).toString();
      let raw = (await fs.readFile(
        path.join(__dirname, '/dist/style.css')
      )).toString();
      let map = (await fs.readFile(
        path.join(__dirname, '/dist/style.css.map')
      )).toString();

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));

      assert(map.includes('background-color:'));
      assert(map.includes('font-family:'));
      assert(map.includes('width:'));

      let sourceMap = await new SourceMap().addMap(JSON.parse(map));

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'body',
        sourcePath: '../integration/sourcemap-css-import/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'background-color',
        sourcePath: '../integration/sourcemap-css-import/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: otherStyle,
        generated: raw,
        str: 'div',
        sourcePath: '../integration/sourcemap-css-import/other-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: otherStyle,
        generated: raw,
        str: 'width',
        sourcePath: '../integration/sourcemap-css-import/other-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: anotherStyle,
        generated: raw,
        str: 'main',
        sourcePath: '../integration/sourcemap-css-import/another-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: anotherStyle,
        generated: raw,
        str: 'font-family',
        sourcePath: '../integration/sourcemap-css-import/another-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }

    await test(false);
    await test(true);
  });

  it('should create a valid sourcemap for a SASS asset', async function() {
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

      let input = (await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-sass/style.scss')
      )).toString();
      let raw = (await fs.readFile(
        path.join(__dirname, '/dist/style.css')
      )).toString();
      let map = (await fs.readFile(
        path.join(__dirname, '/dist/style.css.map')
      )).toString();

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));

      assert(map.includes('$variable:'));

      let sourceMap = await new SourceMap().addMap(JSON.parse(map));

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'body',
        sourcePath: '../integration/sourcemap-sass/style.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'color',
        sourcePath: '../integration/sourcemap-sass/style.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }

    await test(false);
    await test(true);
  });

  it('should create a valid sourcemap when a CSS asset imports SASS', async function() {
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

      let style = (await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-sass-imported/style.css')
      )).toString();
      let other = (await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-sass-imported/other.scss')
      )).toString();
      let raw = (await fs.readFile(
        path.join(__dirname, '/dist/style.css')
      )).toString();
      let map = (await fs.readFile(
        path.join(__dirname, '/dist/style.css.map')
      )).toString();

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));

      assert(map.includes('$variable:'));
      assert(map.includes('color:'));

      let sourceMap = await new SourceMap().addMap(JSON.parse(map));

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'body',
        sourcePath: '../integration/sourcemap-sass-imported/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'color',
        sourcePath: '../integration/sourcemap-sass-imported/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: other,
        generated: raw,
        str: 'div',
        sourcePath: '../integration/sourcemap-sass-imported/other.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: other,
        generated: raw,
        str: 'font-family',
        sourcePath: '../integration/sourcemap-sass-imported/other.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }
    await test(false);
    await test(true);
  });

  it('should create a valid sourcemap for a LESS asset', async function() {
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

      let input = (await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-less/style.less')
      )).toString();
      let raw = (await fs.readFile(
        path.join(__dirname, '/dist/style.css')
      )).toString();
      let map = (await fs.readFile(
        path.join(__dirname, '/dist/style.css.map')
      )).toString();

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));

      assert(map.includes('@value:'));

      let sourceMap = await new SourceMap().addMap(JSON.parse(map));

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'div',
        sourcePath: '../integration/sourcemap-less/style.less',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'width',
        sourcePath: '../integration/sourcemap-less/style.less',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }
    await test(false);
    await test(true);
  });

  it('should load existing sourcemaps for CSS files', async function() {
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

      let style = (await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-css-existing/style.css')
      )).toString();
      let library = (await fs.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-existing/library.raw.scss'
        )
      )).toString();
      let raw = (await fs.readFile(
        path.join(__dirname, '/dist/style.css')
      )).toString();
      let map = (await fs.readFile(
        path.join(__dirname, '/dist/style.css.map')
      )).toString();

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));

      assert(map.includes('$font-stack:'));
      assert(map.includes('display:'));

      let sourceMap = await new SourceMap().addMap(JSON.parse(map));

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'main',
        sourcePath: '../integration/sourcemap-css-existing/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'display',
        sourcePath: '../integration/sourcemap-css-existing/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: library,
        generated: raw,
        str: 'body',
        sourcePath: '../integration/sourcemap-css-existing/library.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: library,
        generated: raw,
        str: 'div',
        generatedStr: 'body div',
        sourcePath: '../integration/sourcemap-css-existing/library.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });

      checkSourceMapping({
        map: sourceMap,
        source: library,
        generated: raw,
        str: 'background-color',
        sourcePath: '../integration/sourcemap-css-existing/library.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification'
      });
    }
    await test(false);
    await test(true);
  });
});
