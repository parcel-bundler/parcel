import assert from 'assert';
import path from 'path';
import os from 'os';
import SourceMap from '@parcel/source-map';
import {
  bundle as _bundle,
  assertBundleTree,
  inputFS,
  outputFS,
  shallowEqual,
} from '@parcel/test-utils';
import {loadSourceMapUrl} from '@parcel/utils';

const bundle = (name, opts = {}) => _bundle(name, {sourceMaps: true, ...opts});

function indexToLineCol(str, index) {
  let beforeIndex = str.slice(0, index);
  return {
    line: beforeIndex.split('\n').length,
    column: index - beforeIndex.lastIndexOf('\n') - 1,
  };
}

function checkSourceMapping({
  map,
  source,
  generated,
  str,
  generatedStr = str,
  sourcePath,
  msg = '',
}) {
  assert(
    generated.indexOf(generatedStr) !== -1,
    "'" + generatedStr + "' not found in generated code",
  );
  assert(source.indexOf(str) !== -1, "'" + str + "' not in source code");

  let generatedPosition = indexToLineCol(
    generated,
    generated.indexOf(generatedStr),
  );

  let matchIndex = source.indexOf(str);
  let matchWhitespaceIndex = matchIndex;
  while (
    matchWhitespaceIndex > 0 &&
    [' ', '\t'].includes(source[matchWhitespaceIndex - 1])
  ) {
    matchWhitespaceIndex--;
  }

  let sourceWhitespacePosition = indexToLineCol(source, matchWhitespaceIndex);
  let sourcePosition = indexToLineCol(source, matchIndex);

  let mapping = map.findClosestMapping(
    generatedPosition.line,
    generatedPosition.column,
  );

  assert(mapping, "no mapping for '" + str + "'" + msg);

  let generatedDiff = {
    line: generatedPosition.line - mapping.generated.line,
    column: generatedPosition.column - mapping.generated.column,
  };

  let computedSourcePosition = {
    line: mapping.original.line + generatedDiff.line,
    column: mapping.original.column + generatedDiff.column,
  };

  let computedMapping = {
    line: computedSourcePosition.line,
    column: computedSourcePosition.column,
    source: mapping.source,
  };

  let sourceMapping = {
    line: sourcePosition.line,
    column: sourcePosition.column,
    source: sourcePath,
  };

  let sourceWhitespaceMapping = {
    line: sourceWhitespacePosition.line,
    column: sourceWhitespacePosition.column,
    source: sourcePath,
  };

  assert(
    shallowEqual(computedMapping, sourceMapping) ||
      shallowEqual(computedMapping, sourceWhitespaceMapping),
    "mapping '" +
      str +
      "' appears to be incorrect: " +
      msg +
      '\n\nExpected computed mapping ' +
      JSON.stringify(computedMapping) +
      ' to equal either\n\n' +
      JSON.stringify(sourceMapping) +
      '\nor, accepting whitespace,\n' +
      JSON.stringify(sourceWhitespaceMapping),
  );
}

describe('sourcemaps', function() {
  it('Should create a basic browser sourcemap', async function() {
    let sourceFilename = path.join(
      __dirname,
      '/integration/sourcemap/index.js',
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
      'sourceRoot should be the project root mounted to dev server.',
    );

    let sourceMap = new SourceMap();
    sourceMap.addRawMappings(map.mappings, map.sources, map.names);
    let input = await inputFS.readFile(sourceFilename, 'utf8');
    let sourcePath = 'index.js';

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'function helloWorld',
      sourcePath,
    });

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'module.exports = helloWorld;',
      sourcePath,
    });

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: '"hello world"',
      sourcePath,
    });
  });

  it('Should create a basic node sourcemap', async function() {
    let sourceFilename = path.join(
      __dirname,
      '/integration/sourcemap-node/index.js',
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
      '../',
      'sourceRoot should be the root of the source files, relative to the output directory.',
    );

    let sourceMap = new SourceMap();
    sourceMap.addRawMappings(map.mappings, map.sources, map.names);
    let input = await inputFS.readFile(sourceFilename, 'utf8');
    let sourcePath = 'index.js';
    let mapData = sourceMap.getMap();
    assert.equal(mapData.sources.length, 1);

    assert(
      await inputFS.exists(path.resolve(distDir + sourceRoot + sourcePath)),
      'combining sourceRoot and sources object should resolve to the original file',
    );

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'function helloWorld',
      sourcePath,
    });

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'module.exports = helloWorld;',
      sourcePath,
    });

    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: '"hello world"',
      sourcePath,
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
      '../',
      'sourceRoot should be the root of the source files, relative to the output directory.',
    );

    let sourceMap = new SourceMap();
    sourceMap.addRawMappings(map.mappings, map.sources, map.names);
    let mapData = sourceMap.getMap();
    assert.equal(mapData.sources.length, 3);

    for (let source of mapData.sources) {
      assert(
        await inputFS.exists(path.resolve(distDir + sourceRoot + source)),
        'combining sourceRoot and sources object should resolve to the original file',
      );
    }

    let inputs = [
      await inputFS.readFile(sourceFilename, 'utf8'),
      await inputFS.readFile(path.join(sourceDir, 'local.js'), 'utf8'),
      await inputFS.readFile(path.join(sourceDir, 'utils/util.js'), 'utf8'),
    ];

    checkSourceMapping({
      map: sourceMap,
      source: inputs[0],
      generated: raw,
      str: 'const local',
      sourcePath: 'index.js',
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[0],
      generated: raw,
      str: 'local.a',
      sourcePath: 'index.js',
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[1],
      generated: raw,
      str: 'exports.a',
      sourcePath: 'local.js',
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[2],
      generated: raw,
      str: 'exports.count = function(a, b) {',
      generatedStr: 'exports.count = function (a, b) {',
      sourcePath: 'utils/util.js',
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[2],
      generated: raw,
      str: 'return a + b',
      sourcePath: 'utils/util.js',
    });
  });

  it('should create a valid sourcemap for a minified js bundle with requires', async function() {
    let sourceDir = path.join(
      __dirname,
      '/integration/sourcemap-nested-minified/',
    );
    let sourceFilename = path.join(sourceDir, '/index.js');
    await bundle(sourceFilename, {
      minify: true,
    });

    let distDir = path.join(
      __dirname,
      '/integration/sourcemap-nested-minified/dist/',
    );
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
      '../',
      'sourceRoot should be the root of the source files, relative to the output directory.',
    );

    let sourceMap = new SourceMap();
    sourceMap.addRawMappings(map.mappings, map.sources, map.names);
    let mapData = sourceMap.getMap();
    assert.equal(mapData.sources.length, 3);

    for (let source of mapData.sources) {
      assert(
        await inputFS.exists(path.resolve(distDir + sourceRoot + source)),
        'combining sourceRoot and sources object should resolve to the original file',
      );
    }

    let inputs = [
      await inputFS.readFile(sourceFilename, 'utf8'),
      await inputFS.readFile(path.join(sourceDir, 'local.js'), 'utf8'),
      await inputFS.readFile(path.join(sourceDir, 'utils/util.js'), 'utf8'),
    ];

    // TODO: Figure out a way to tests these without relying on generatedStr as much
    checkSourceMapping({
      map: sourceMap,
      source: inputs[0],
      generated: raw,
      str: 'const local',
      generatedStr: 'const t',
      sourcePath: 'index.js',
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[0],
      generated: raw,
      str: 'local.a',
      generatedStr: 't.a',
      sourcePath: 'index.js',
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[1],
      generated: raw,
      str: 'exports.a',
      generatedStr: 'o.a',
      sourcePath: 'local.js',
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[2],
      generated: raw,
      str: 'exports.count = function(a, b) {',
      generatedStr: 'o.count=function(e,n){',
      sourcePath: 'utils/util.js',
    });

    checkSourceMapping({
      map: sourceMap,
      source: inputs[2],
      generated: raw,
      str: 'return a + b',
      generatedStr: 'return e+n',
      sourcePath: 'utils/util.js',
    });
  });

  it('should create a valid sourcemap as a child of a TS bundle', async function() {
    let inputFilePath = path.join(
      __dirname,
      '/integration/sourcemap-typescript/index.ts',
    );

    await bundle(inputFilePath);
    let distDir = path.join(__dirname, '../dist/');
    let filename = path.join(distDir, 'index.js');
    let raw = await outputFS.readFile(filename, 'utf8');
    let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
    if (!mapUrlData) {
      throw new Error('Could not load map');
    }
    let map = mapUrlData.map;

    assert.equal(map.file, 'index.js.map');
    assert(raw.includes('//# sourceMappingURL=index.js.map'));
    assert.equal(map.sourceRoot, '/__parcel_source_root/');

    let sourceMap = new SourceMap();
    sourceMap.addRawMappings(map.mappings, map.sources, map.names);

    let mapData = sourceMap.getMap();
    assert.equal(mapData.sources.length, 1);
    assert.deepEqual(mapData.sources, ['index.ts']);

    let input = await inputFS.readFile(inputFilePath, 'utf-8');
    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'function env()',
      sourcePath: 'index.ts',
    });
  });

  it('should create a valid sourcemap as a child of a nested TS bundle', async function() {
    let inputFilePath = path.join(
      __dirname,
      '/integration/sourcemap-typescript-nested/index.ts',
    );

    await bundle(inputFilePath);
    let distDir = path.join(__dirname, '../dist/');
    let filename = path.join(distDir, 'index.js');
    let raw = await outputFS.readFile(filename, 'utf8');
    let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
    if (!mapUrlData) {
      throw new Error('Could not load map');
    }
    let map = mapUrlData.map;

    assert.equal(map.file, 'index.js.map');
    assert(raw.includes('//# sourceMappingURL=index.js.map'));
    assert.equal(map.sourceRoot, '/__parcel_source_root/');

    let sourceMap = new SourceMap();
    sourceMap.addRawMappings(map.mappings, map.sources, map.names);

    let mapData = sourceMap.getMap();
    assert.equal(mapData.sources.length, 2);
    assert.deepEqual(mapData.sources, ['index.ts', 'local.ts']);

    let input = await inputFS.readFile(inputFilePath, 'utf-8');
    checkSourceMapping({
      map: sourceMap,
      source: input,
      generated: raw,
      str: 'function env()',
      sourcePath: 'index.ts',
    });

    let local = await inputFS.readFile(
      path.join(__dirname, '/integration/sourcemap-typescript-nested/local.ts'),
      'utf-8',
    );
    checkSourceMapping({
      map: sourceMap,
      source: local,
      generated: raw,
      str: 'exports.local',
      sourcePath: 'local.ts',
    });
  });

  it('should create a valid sourcemap for a CSS bundle', async function() {
    async function test(minify) {
      let inputFilePath = path.join(
        __dirname,
        '/integration/sourcemap-css/style.css',
      );

      await bundle(inputFilePath, {minify});
      let distDir = path.join(__dirname, '../dist/');
      let filename = path.join(distDir, 'style.css');
      let raw = await outputFS.readFile(filename, 'utf8');
      let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
      if (!mapUrlData) {
        throw new Error('Could not load map');
      }
      let map = mapUrlData.map;

      assert.equal(map.file, 'style.css.map');
      assert(raw.includes('/*# sourceMappingURL=style.css.map */'));
      assert.equal(map.sourceRoot, '/__parcel_source_root/');

      let sourceMap = new SourceMap();
      sourceMap.addRawMappings(map.mappings, map.sources, map.names);

      let input = await inputFS.readFile(inputFilePath, 'utf-8');

      let mapData = sourceMap.getMap();
      assert.equal(mapData.sources.length, 1);
      assert.deepEqual(mapData.sources, ['style.css']);

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'body',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'background-color',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });
    }

    await test(false);
    await test(true);
  });

  it('should create a valid sourcemap for a CSS bundle with imports', async function() {
    async function test(minify) {
      let inputFilePath = path.join(
        __dirname,
        '/integration/sourcemap-css-import/style.css',
      );

      await bundle(inputFilePath, {minify});
      let distDir = path.join(__dirname, '../dist/');
      let filename = path.join(distDir, 'style.css');
      let raw = await outputFS.readFile(filename, 'utf8');
      let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
      if (!mapUrlData) {
        throw new Error('Could not load map');
      }
      let map = mapUrlData.map;

      assert.equal(map.file, 'style.css.map');
      assert(raw.includes('/*# sourceMappingURL=style.css.map */'));
      assert.equal(map.sourceRoot, '/__parcel_source_root/');

      let sourceMap = new SourceMap();
      sourceMap.addRawMappings(map.mappings, map.sources, map.names);

      let style = await inputFS.readFile(inputFilePath, 'utf-8');
      let otherStyle = await inputFS.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-import/other-style.css',
        ),
        'utf-8',
      );
      let anotherStyle = await inputFS.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-import/another-style.css',
        ),
        'utf-8',
      );

      let mapData = sourceMap.getMap();
      assert.equal(mapData.sources.length, 3);
      assert.deepEqual(mapData.sources, [
        'other-style.css',
        'another-style.css',
        // TODO: Is this a bug?
        'test/integration/sourcemap-css-import/style.css',
      ]);

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'body',
        sourcePath: 'test/integration/sourcemap-css-import/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'background-color',
        sourcePath: 'test/integration/sourcemap-css-import/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: otherStyle,
        generated: raw,
        str: 'div',
        sourcePath: 'other-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: otherStyle,
        generated: raw,
        str: 'width',
        sourcePath: 'other-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: anotherStyle,
        generated: raw,
        str: 'main',
        sourcePath: 'another-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: anotherStyle,
        generated: raw,
        str: 'font-family',
        sourcePath: 'another-style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });
    }

    await test(false);
    await test(true);
  });

  it('should create a valid sourcemap for a SASS asset', async function() {
    async function test(minify) {
      let inputFilePath = path.join(
        __dirname,
        '/integration/sourcemap-sass/style.scss',
      );

      await bundle(inputFilePath, {minify});
      let distDir = path.join(__dirname, '../dist/');
      let filename = path.join(distDir, 'style.css');
      let raw = await outputFS.readFile(filename, 'utf8');
      let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
      if (!mapUrlData) {
        throw new Error('Could not load map');
      }
      let map = mapUrlData.map;

      assert.equal(map.file, 'style.css.map');
      assert(raw.includes('/*# sourceMappingURL=style.css.map */'));
      assert.equal(map.sourceRoot, '/__parcel_source_root/');

      let sourceMap = new SourceMap();
      sourceMap.addRawMappings(map.mappings, map.sources, map.names);

      let input = await inputFS.readFile(inputFilePath, 'utf-8');
      let mapData = sourceMap.getMap();
      assert.equal(mapData.sources.length, minify ? 2 : 1);
      assert.deepEqual(mapData.sources[0], 'style.scss');

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'body',
        sourcePath: 'style.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'color',
        sourcePath: 'style.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });
    }

    await test(false);
    await test(true);
  });

  it('should create a valid sourcemap when for a CSS asset importing SASS', async function() {
    async function test(minify) {
      let inputFilePath = path.join(
        __dirname,
        '/integration/sourcemap-sass-imported/style.css',
      );

      await bundle(inputFilePath, {minify});
      let distDir = path.join(__dirname, '../dist/');
      let filename = path.join(distDir, 'style.css');
      let raw = await outputFS.readFile(filename, 'utf8');
      let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
      if (!mapUrlData) {
        throw new Error('Could not load map');
      }
      let map = mapUrlData.map;

      assert.equal(map.file, 'style.css.map');
      assert(raw.includes('/*# sourceMappingURL=style.css.map */'));
      assert.equal(map.sourceRoot, '/__parcel_source_root/');

      let sourceMap = new SourceMap();
      sourceMap.addRawMappings(map.mappings, map.sources, map.names);

      let style = await inputFS.readFile(inputFilePath, 'utf-8');
      let other = await inputFS.readFile(
        path.join(__dirname, '/integration/sourcemap-sass-imported/other.scss'),
        'utf-8',
      );
      let mapData = sourceMap.getMap();
      assert.equal(mapData.sources.length, minify ? 3 : 2);
      assert.deepEqual(mapData.sources[0], 'other.scss');
      // TODO: Figure out why this happens?
      assert.deepEqual(
        mapData.sources[minify ? 2 : 1],
        'test/integration/sourcemap-sass-imported/style.css',
      );

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'body',
        sourcePath: 'test/integration/sourcemap-sass-imported/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'color',
        sourcePath: 'test/integration/sourcemap-sass-imported/style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: other,
        generated: raw,
        str: 'div',
        sourcePath: 'other.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: other,
        generated: raw,
        str: 'font-family',
        sourcePath: 'other.scss',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });
    }
    await test(false);
    await test(true);
  });

  it('should create a valid sourcemap for a LESS asset', async function() {
    async function test(minify) {
      let inputFilePath = path.join(
        __dirname,
        '/integration/sourcemap-less/style.less',
      );

      await bundle(inputFilePath, {minify});
      let distDir = path.join(__dirname, '../dist/');
      let filename = path.join(distDir, 'style.css');
      let raw = await outputFS.readFile(filename, 'utf8');
      let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
      if (!mapUrlData) {
        throw new Error('Could not load map');
      }
      let map = mapUrlData.map;

      assert.equal(map.file, 'style.css.map');
      assert(raw.includes('/*# sourceMappingURL=style.css.map */'));
      assert.equal(map.sourceRoot, '/__parcel_source_root/');

      let sourceMap = new SourceMap();
      sourceMap.addRawMappings(map.mappings, map.sources, map.names);

      let mapData = sourceMap.getMap();
      assert.equal(mapData.sources.length, minify ? 2 : 1);
      assert.deepEqual(mapData.sources[0], 'style.less');
      let input = await inputFS.readFile(inputFilePath, 'utf-8');

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'div',
        sourcePath: 'style.less',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: input,
        generated: raw,
        str: 'width',
        sourcePath: 'style.less',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });
    }

    await test(false);
    await test(true);
  });

  it('Should be able to create a sourcemap with inlined sources', async function() {
    let sourceFilename = path.join(
      __dirname,
      '/integration/sourcemap-inline-sources/index.js',
    );
    await bundle(sourceFilename);

    let distDir = path.join(
      __dirname,
      '/integration/sourcemap-inline-sources/dist/',
    );

    let filename = path.join(distDir, 'index.js');
    let raw = await outputFS.readFile(filename, 'utf8');

    let mapData = await loadSourceMapUrl(outputFS, filename, raw);
    if (!mapData) {
      throw new Error('Could not load map');
    }

    let sourceContent = await inputFS.readFile(sourceFilename, 'utf-8');

    let map = mapData.map;
    assert.equal(map.file, 'index.js.map');
    assert.deepEqual(map.sources, ['index.js']);
    assert.equal(map.sourcesContent[0], sourceContent);
  });

  it('Should be able to create inline sourcemaps', async function() {
    let sourceFilename = path.join(
      __dirname,
      '/integration/sourcemap-generate-inline/index.js',
    );
    await bundle(sourceFilename);

    let distDir = path.join(
      __dirname,
      '/integration/sourcemap-generate-inline/dist/',
    );

    let filename = path.join(distDir, 'index.js');
    let raw = await outputFS.readFile(filename, 'utf8');

    let mapUrlData = await loadSourceMapUrl(outputFS, filename, raw);
    if (!mapUrlData) {
      throw new Error('Could not load map');
    }

    assert(
      mapUrlData.url.startsWith('data:application/json;charset=utf-8;base64,'),
      'inline sourcemap bundles should have a base64 url',
    );

    let map = mapUrlData.map;
    assert.equal(map.file, 'index.js.map');
    assert.deepEqual(map.sources, ['index.js']);
  });

  it('should respect --no-source-maps', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap/index.js'),
      {
        sourceMaps: false,
      },
    );

    assert.deepStrictEqual(
      await outputFS.readdir(path.dirname(b.getBundles()[0].filePath)),
      ['index.js'],
    );
  });

  it.skip('should load existing sourcemaps for CSS files', async function() {
    async function test(minify) {
      let b = await bundle(
        path.join(__dirname, '/integration/sourcemap-css-existing/style.css'),
        {minify},
      );

      await assertBundleTree(b, {
        name: 'style.css',
        assets: ['style.css', 'library.css'],
        childBundles: [
          {
            name: 'style.css.map',
            type: 'map',
          },
        ],
      });

      let style = await inputFS.readFile(
        path.join(__dirname, '/integration/sourcemap-css-existing/style.css'),
        'utf8',
      );
      let library = await inputFS.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-existing/test/library.raw.scss',
        ),
        'utf8',
      );
      let raw = await outputFS.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8',
      );
      let map = JSON.parse(
        await outputFS.readFile(
          path.join(__dirname, '/dist/style.css.map'),
          'utf8',
        ),
      );

      assert(raw.includes('/*# sourceMappingURL=/style.css.map */'));
      assert.equal(
        map.sourceRoot,
        path.normalize('../integration/sourcemap-css-existing'),
      );

      let sourceMap = await new SourceMap().addMap(map);
      assert.equal(Object.keys(sourceMap.sources).length, 2);
      assert.equal(sourceMap.sources['style.css'], style);
      assert.equal(
        sourceMap.sources[path.normalize('test/library.scss')],
        library.replace(new RegExp(os.EOL, 'g'), '\n'),
      );

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'main',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: style,
        generated: raw,
        str: 'display',
        sourcePath: 'style.css',
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: library,
        generated: raw,
        str: 'body',
        sourcePath: path.normalize('test/library.scss'),
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: library,
        generated: raw,
        str: 'div',
        generatedStr: 'body div',
        sourcePath: path.normalize('test/library.scss'),
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });

      checkSourceMapping({
        map: sourceMap,
        source: library,
        generated: raw,
        str: 'background-color',
        sourcePath: path.normalize('test/library.scss'),
        msg: ' ' + (minify ? 'with' : 'without') + ' minification',
      });
    }
    await test(false);
    await test(true);
  });

  it.skip('should load existing sourcemaps of libraries', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-existing/index.js'),
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'sum.js'],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let jsOutput = await outputFS.readFile(b.name, 'utf8');

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22),
    );

    assert(
      await outputFS.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist',
    );

    let map = await outputFS.readFile(path.join(sourcemapReference), 'utf8');
    assert(
      map.indexOf('module.exports = (a, b) => a + b') > -1,
      'Sourcemap should contain the existing sourcemap',
    );
  });

  it.skip('should load inline sourcemaps of libraries', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-inline/index.js'),
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'sum.js'],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let jsOutput = await outputFS.readFile(b.name, 'utf8');

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22),
    );

    assert(
      await outputFS.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist',
    );

    let map = await outputFS.readFile(path.join(sourcemapReference), 'utf8');
    assert(
      map.indexOf('module.exports = (a, b) => a + b') > -1,
      'Sourcemap should contain the existing sourcemap',
    );
  });

  it.skip('should load referenced contents of sourcemaps', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sourcemap-external-contents/index.js'),
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'sum.js'],
      childBundles: [
        {
          type: 'map',
        },
      ],
    });

    let jsOutput = await outputFS.readFile(b.name, 'utf8');

    let sourcemapReference = path.join(
      __dirname,
      '/dist/',
      jsOutput.substring(jsOutput.lastIndexOf('//# sourceMappingURL') + 22),
    );

    assert(
      await outputFS.exists(path.join(sourcemapReference)),
      'referenced sourcemap should exist',
    );

    let map = await outputFS.readFile(path.join(sourcemapReference), 'utf8');
    assert(
      map.indexOf('module.exports = (a, b) => a + b') > -1,
      'Sourcemap should contain the existing sourcemap',
    );
  });
});
