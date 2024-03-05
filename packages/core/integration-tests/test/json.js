import assert from 'assert';
import path from 'path';
import {
  assertBundles,
  bundle,
  distDir,
  outputFS,
  run,
} from '@parcel/test-utils';

describe('json', function () {
  it('should support requiring JSON files', async function () {
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

  it('should support requiring JSON5 files', async function () {
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

  it('should minify JSON files', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/uglify-json/index.json'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
          shouldScopeHoist: false,
        },
      },
    );

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{"test":"test"}'));

    let output = await run(b);
    assert.deepEqual(output, {test: 'test'});
  });

  it('should minify JSON5 files', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/uglify-json5/index.json5'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
          shouldScopeHoist: false,
        },
      },
    );

    let json = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(json.includes('{"test":"test"}'));

    let output = await run(b);
    assert.deepEqual(output, {test: 'test'});
  });
});
