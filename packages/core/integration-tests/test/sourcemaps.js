const assert = require('assert');
const fs = require('@parcel/fs');
const path = require('path');
const os = require('os');
const SourceMap = require('parcel-bundler/src/SourceMap');
const {bundle, run, assertBundleTree} = require('@parcel/test-utils');
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

describe.only('sourcemaps', function() {
  it('Should create a basic browser sourcemap', async function() {
    let sourceFilename = path.join(
      __dirname,
      '/integration/sourcemap/index.js'
    );
    await bundle(sourceFilename);

    let distDir = path.join(__dirname, '/integration/sourcemap/dist/');

    let filename = path.join(distDir, 'index.js');
    let raw = await fs.readFile(filename, 'utf8');
    let mapUrlData = await loadSourceMapUrl(filename, raw);
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
    let input = await fs.readFile(sourceFilename, 'utf8');
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
      str: 'hello world',
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
    let raw = await fs.readFile(filename, 'utf8');
    let mapUrlData = await loadSourceMapUrl(filename, raw);
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
    let input = await fs.readFile(sourceFilename, 'utf8');
    let sourcePath =
      'packages/core/integration-tests/test/integration/sourcemap-node/index.js';
    assert.equal(Object.keys(sourceMap.sources).length, 1);
    assert.strictEqual(sourceMap.sources[sourcePath], null);
    assert(
      await fs.exists(distDir + sourceRoot + sourcePath),
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
      str: 'hello world',
      sourcePath
    });
  });

  it('should create a valid sourcemap for a js file with requires', async function() {
    let sourceDir = path.join(__dirname, '/integration/sourcemap-nested/');
    let sourceFilename = path.join(sourceDir, '/index.js');
    await bundle(sourceFilename);

    let distDir = path.join(__dirname, '/integration/sourcemap-nested/dist/');
    let filename = path.join(distDir, 'index.js');
    let raw = await fs.readFile(filename, 'utf8');
    let mapUrlData = await loadSourceMapUrl(filename, raw);
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
        await fs.exists(distDir + sourceRoot + source),
        'combining sourceRoot and sources object should resolve to the original file'
      );
    }

    let inputs = [
      await fs.readFile(sourceFilename, 'utf8'),
      await fs.readFile(path.join(sourceDir, 'local.js'), 'utf8'),
      await fs.readFile(path.join(sourceDir, 'utils/util.js'), 'utf8')
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

    // TODO: Figure out why this fails
    // Mappings seem right though: https://sokra.github.io/source-map-visualization/#base64,Ly8gbW9kdWxlcyBhcmUgZGVmaW5lZCBhcyBhbiBhcnJheQovLyBbIG1vZHVsZSBmdW5jdGlvbiwgbWFwIG9mIHJlcXVpcmVzIF0KLy8KLy8gbWFwIG9mIHJlcXVpcmVzIGlzIHNob3J0IHJlcXVpcmUgbmFtZSAtPiBudW1lcmljIHJlcXVpcmUKLy8KLy8gYW55dGhpbmcgZGVmaW5lZCBpbiBhIHByZXZpb3VzIGJ1bmRsZSBpcyBhY2Nlc3NlZCB2aWEgdGhlCi8vIG9yaWcgbWV0aG9kIHdoaWNoIGlzIHRoZSByZXF1aXJlIGZvciBwcmV2aW91cyBidW5kbGVzCgovLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tZ2xvYmFsLWFzc2lnbgpwYXJjZWxSZXF1aXJlID0gZnVuY3Rpb24obW9kdWxlcywgY2FjaGUsIGVudHJ5LCBnbG9iYWxOYW1lKSB7CiAgLy8gU2F2ZSB0aGUgcmVxdWlyZSBmcm9tIHByZXZpb3VzIGJ1bmRsZSB0byB0aGlzIGNsb3N1cmUgaWYgYW55CiAgdmFyIHByZXZpb3VzUmVxdWlyZSA9IHR5cGVvZiBwYXJjZWxSZXF1aXJlID09PSAnZnVuY3Rpb24nICYmIHBhcmNlbFJlcXVpcmU7CiAgdmFyIG5vZGVSZXF1aXJlID0gdHlwZW9mIHJlcXVpcmUgPT09ICdmdW5jdGlvbicgJiYgcmVxdWlyZTsKCiAgZnVuY3Rpb24gbmV3UmVxdWlyZShuYW1lLCBqdW1wZWQpIHsKICAgIGlmICghY2FjaGVbbmFtZV0pIHsKICAgICAgaWYgKCFtb2R1bGVzW25hbWVdKSB7CiAgICAgICAgLy8gaWYgd2UgY2Fubm90IGZpbmQgdGhlIG1vZHVsZSB3aXRoaW4gb3VyIGludGVybmFsIG1hcCBvcgogICAgICAgIC8vIGNhY2hlIGp1bXAgdG8gdGhlIGN1cnJlbnQgZ2xvYmFsIHJlcXVpcmUgaWUuIHRoZSBsYXN0IGJ1bmRsZQogICAgICAgIC8vIHRoYXQgd2FzIGFkZGVkIHRvIHRoZSBwYWdlLgogICAgICAgIHZhciBjdXJyZW50UmVxdWlyZSA9CiAgICAgICAgICB0eXBlb2YgcGFyY2VsUmVxdWlyZSA9PT0gJ2Z1bmN0aW9uJyAmJiBwYXJjZWxSZXF1aXJlOwogICAgICAgIGlmICghanVtcGVkICYmIGN1cnJlbnRSZXF1aXJlKSB7CiAgICAgICAgICByZXR1cm4gY3VycmVudFJlcXVpcmUobmFtZSwgdHJ1ZSk7CiAgICAgICAgfQoKICAgICAgICAvLyBJZiB0aGVyZSBhcmUgb3RoZXIgYnVuZGxlcyBvbiB0aGlzIHBhZ2UgdGhlIHJlcXVpcmUgZnJvbSB0aGUKICAgICAgICAvLyBwcmV2aW91cyBvbmUgaXMgc2F2ZWQgdG8gJ3ByZXZpb3VzUmVxdWlyZScuIFJlcGVhdCB0aGlzIGFzCiAgICAgICAgLy8gbWFueSB0aW1lcyBhcyB0aGVyZSBhcmUgYnVuZGxlcyB1bnRpbCB0aGUgbW9kdWxlIGlzIGZvdW5kIG9yCiAgICAgICAgLy8gd2UgZXhoYXVzdCB0aGUgcmVxdWlyZSBjaGFpbi4KICAgICAgICBpZiAocHJldmlvdXNSZXF1aXJlKSB7CiAgICAgICAgICByZXR1cm4gcHJldmlvdXNSZXF1aXJlKG5hbWUsIHRydWUpOwogICAgICAgIH0KCiAgICAgICAgLy8gVHJ5IHRoZSBub2RlIHJlcXVpcmUgZnVuY3Rpb24gaWYgaXQgZXhpc3RzLgogICAgICAgIGlmIChub2RlUmVxdWlyZSAmJiB0eXBlb2YgbmFtZSA9PT0gJ3N0cmluZycpIHsKICAgICAgICAgIHJldHVybiBub2RlUmVxdWlyZShuYW1lKTsKICAgICAgICB9CgogICAgICAgIHZhciBlcnIgPSBuZXcgRXJyb3IoIkNhbm5vdCBmaW5kIG1vZHVsZSAnIiArIG5hbWUgKyAiJyIpOwogICAgICAgIGVyci5jb2RlID0gJ01PRFVMRV9OT1RfRk9VTkQnOwogICAgICAgIHRocm93IGVycjsKICAgICAgfQoKICAgICAgbG9jYWxSZXF1aXJlLnJlc29sdmUgPSByZXNvbHZlOwogICAgICBsb2NhbFJlcXVpcmUuY2FjaGUgPSB7fTsKCiAgICAgIHZhciBtb2R1bGUgPSAoY2FjaGVbbmFtZV0gPSBuZXcgbmV3UmVxdWlyZS5Nb2R1bGUobmFtZSkpOwoKICAgICAgbW9kdWxlc1tuYW1lXVswXS5jYWxsKAogICAgICAgIG1vZHVsZS5leHBvcnRzLAogICAgICAgIGxvY2FsUmVxdWlyZSwKICAgICAgICBtb2R1bGUsCiAgICAgICAgbW9kdWxlLmV4cG9ydHMsCiAgICAgICAgdGhpcwogICAgICApOwogICAgfQoKICAgIHJldHVybiBjYWNoZVtuYW1lXS5leHBvcnRzOwoKICAgIGZ1bmN0aW9uIGxvY2FsUmVxdWlyZSh4KSB7CiAgICAgIHJldHVybiBuZXdSZXF1aXJlKGxvY2FsUmVxdWlyZS5yZXNvbHZlKHgpKTsKICAgIH0KCiAgICBmdW5jdGlvbiByZXNvbHZlKHgpIHsKICAgICAgcmV0dXJuIG1vZHVsZXNbbmFtZV1bMV1beF0gfHwgeDsKICAgIH0KICB9CgogIGZ1bmN0aW9uIE1vZHVsZShtb2R1bGVOYW1lKSB7CiAgICB0aGlzLmlkID0gbW9kdWxlTmFtZTsKICAgIHRoaXMuYnVuZGxlID0gbmV3UmVxdWlyZTsKICAgIHRoaXMuZXhwb3J0cyA9IHt9OwogIH0KCiAgbmV3UmVxdWlyZS5pc1BhcmNlbFJlcXVpcmUgPSB0cnVlOwogIG5ld1JlcXVpcmUuTW9kdWxlID0gTW9kdWxlOwogIG5ld1JlcXVpcmUubW9kdWxlcyA9IG1vZHVsZXM7CiAgbmV3UmVxdWlyZS5jYWNoZSA9IGNhY2hlOwogIG5ld1JlcXVpcmUucGFyZW50ID0gcHJldmlvdXNSZXF1aXJlOwogIG5ld1JlcXVpcmUucmVnaXN0ZXIgPSBmdW5jdGlvbihpZCwgZXhwb3J0cykgewogICAgbW9kdWxlc1tpZF0gPSBbCiAgICAgIGZ1bmN0aW9uKHJlcXVpcmUsIG1vZHVsZSkgewogICAgICAgIG1vZHVsZS5leHBvcnRzID0gZXhwb3J0czsKICAgICAgfSwKICAgICAge30KICAgIF07CiAgfTsKCiAgZm9yICh2YXIgaSA9IDA7IGkgPCBlbnRyeS5sZW5ndGg7IGkrKykgewogICAgbmV3UmVxdWlyZShlbnRyeVtpXSk7CiAgfQoKICBpZiAoZW50cnkubGVuZ3RoKSB7CiAgICAvLyBFeHBvc2UgZW50cnkgcG9pbnQgdG8gTm9kZSwgQU1EIG9yIGJyb3dzZXIgZ2xvYmFscwogICAgLy8gQmFzZWQgb24gaHR0cHM6Ly9naXRodWIuY29tL0ZvcmJlc0xpbmRlc2F5L3VtZC9ibG9iL21hc3Rlci90ZW1wbGF0ZS5qcwogICAgdmFyIG1haW5FeHBvcnRzID0gbmV3UmVxdWlyZShlbnRyeVtlbnRyeS5sZW5ndGggLSAxXSk7CgogICAgLy8gQ29tbW9uSlMKICAgIGlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZSAhPT0gJ3VuZGVmaW5lZCcpIHsKICAgICAgbW9kdWxlLmV4cG9ydHMgPSBtYWluRXhwb3J0czsKCiAgICAgIC8vIFJlcXVpcmVKUwogICAgfSBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHsKICAgICAgZGVmaW5lKGZ1bmN0aW9uKCkgewogICAgICAgIHJldHVybiBtYWluRXhwb3J0czsKICAgICAgfSk7CgogICAgICAvLyA8c2NyaXB0PgogICAgfSBlbHNlIGlmIChnbG9iYWxOYW1lKSB7CiAgICAgIHRoaXNbZ2xvYmFsTmFtZV0gPSBtYWluRXhwb3J0czsKICAgIH0KICB9CgogIC8vIE92ZXJyaWRlIHRoZSBjdXJyZW50IHJlcXVpcmUgd2l0aCB0aGlzIG5ldyBvbmUKICByZXR1cm4gbmV3UmVxdWlyZTsKfSh7IjBiN2M5OTNlY2RlODZiNDJhY2NkYjNiNzlkZTY2ZTEyIjpbZnVuY3Rpb24ocmVxdWlyZSxtb2R1bGUsZXhwb3J0cykgewpjb25zdCBsb2NhbCA9IHJlcXVpcmUoJy4vbG9jYWwnKTsKCm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKCkgewogIHJldHVybiBsb2NhbC5hICsgbG9jYWwuYjsKfTsKfSx7Ii4vbG9jYWwiOiI4YzNiOWQ3ZTI3YTM2MzU5OGJiMDNmZTQ2NWNhZmQ5NCJ9XSwiOGMzYjlkN2UyN2EzNjM1OThiYjAzZmU0NjVjYWZkOTQiOltmdW5jdGlvbihyZXF1aXJlLG1vZHVsZSxleHBvcnRzKSB7CmNvbnN0IHV0aWwgPSByZXF1aXJlKCcuL3V0aWxzL3V0aWwnKTsKCmV4cG9ydHMuYSA9IDU7CmV4cG9ydHMuYiA9IHV0aWwuY291bnQoNCwgNSk7Cn0seyIuL3V0aWxzL3V0aWwiOiIyNDc1YzA2ODg0MmZkZmY4NWFjODUxYWU1Mjg2Yzc5ZiJ9XSwiMjQ3NWMwNjg4NDJmZGZmODVhYzg1MWFlNTI4NmM3OWYiOltmdW5jdGlvbihyZXF1aXJlLG1vZHVsZSxleHBvcnRzKSB7CmV4cG9ydHMuY291bnQgPSBmdW5jdGlvbiAoYSwgYikgewogIHJldHVybiBhICsgYjsKfTsKfSx7fV19LHt9LFsiMGI3Yzk5M2VjZGU4NmI0MmFjY2RiM2I3OWRlNjZlMTIiXSwgbnVsbCkKCi8vIyBzb3VyY2VNYXBwaW5nVVJMPWluZGV4LmpzLm1hcAo=,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInBhY2thZ2VzL2NvcmUvaW50ZWdyYXRpb24tdGVzdHMvdGVzdC9pbnRlZ3JhdGlvbi9zb3VyY2VtYXAtbmVzdGVkL2luZGV4LmpzIiwicGFja2FnZXMvY29yZS9pbnRlZ3JhdGlvbi10ZXN0cy90ZXN0L2ludGVncmF0aW9uL3NvdXJjZW1hcC1uZXN0ZWQvbG9jYWwuanMiLCJwYWNrYWdlcy9jb3JlL2ludGVncmF0aW9uLXRlc3RzL3Rlc3QvaW50ZWdyYXRpb24vc291cmNlbWFwLW5lc3RlZC91dGlscy91dGlsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEFDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEFDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJpbmRleC5qcy5tYXAiLCJzb3VyY2VSb290IjoiLi4vLi4vLi4vLi4vLi4vLi4vLi4vIn0=,Y29uc3QgbG9jYWwgPSByZXF1aXJlKCcuL2xvY2FsJyk7Cgptb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKCkgewogIHJldHVybiBsb2NhbC5hICsgbG9jYWwuYjsKfQ==,Y29uc3QgdXRpbCA9IHJlcXVpcmUoJy4vdXRpbHMvdXRpbCcpOwoKZXhwb3J0cy5hID0gNTsKZXhwb3J0cy5iID0gdXRpbC5jb3VudCg0LCA1KTs=,ZXhwb3J0cy5jb3VudCA9IGZ1bmN0aW9uKGEsIGIpIHsKICByZXR1cm4gYSArIGI7Cn0=
    /*checkSourceMapping({
      map: sourceMap,
      source: inputs[2],
      generated: raw,
      str: 'exports.count = function(a, b) {',
      generatedStr: 'exports.count = function (a, b) {',
      sourcePath:
        'packages/core/integration-tests/test/integration/sourcemap-nested/utils/util.js'
    });*/

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

    let raw = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    let map = await fs.readFile(
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

    let raw = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    let map = await fs.readFile(
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

    let raw = await fs.readFile(path.join(__dirname, '/dist/index.js'), 'utf8');
    let map = await fs.readFile(
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

      let input = await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-css/style.css'),
        'utf8'
      );
      let raw = await fs.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await fs.readFile(path.join(__dirname, '/dist/style.css.map'), 'utf8')
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

      let style = await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-css-import/style.css'),
        'utf8'
      );
      let otherStyle = await fs.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-import/other-style.css'
        ),
        'utf8'
      );
      let anotherStyle = await fs.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-import/another-style.css'
        ),
        'utf8'
      );
      let raw = await fs.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await fs.readFile(path.join(__dirname, '/dist/style.css.map'), 'utf8')
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

      let input = await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-sass/style.scss'),
        'utf8'
      );
      let raw = await fs.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await fs.readFile(path.join(__dirname, '/dist/style.css.map'), 'utf8')
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

      let style = await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-sass-imported/style.css'),
        'utf8'
      );
      let other = await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-sass-imported/other.scss'),
        'utf8'
      );
      let raw = await fs.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await fs.readFile(path.join(__dirname, '/dist/style.css.map'), 'utf8')
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

      let input = await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-less/style.less'),
        'utf8'
      );
      let raw = await fs.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await fs.readFile(path.join(__dirname, '/dist/style.css.map'), 'utf8')
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

      let style = await fs.readFile(
        path.join(__dirname, '/integration/sourcemap-css-existing/style.css'),
        'utf8'
      );
      let library = await fs.readFile(
        path.join(
          __dirname,
          '/integration/sourcemap-css-existing/test/library.raw.scss'
        ),
        'utf8'
      );
      let raw = await fs.readFile(
        path.join(__dirname, '/dist/style.css'),
        'utf8'
      );
      let map = JSON.parse(
        await fs.readFile(path.join(__dirname, '/dist/style.css.map'), 'utf8')
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
