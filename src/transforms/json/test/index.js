const assert = require('assert');
const fs = require('@parcel/fs');
const {bundle, run, assertBundleTree} = require('@parcel/test-utils');

describe('json', function () {
  it('should support requiring JSON files', async function() {
    let b = await bundle(__dirname + '/fixtures/json/index.js');

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
    let b = await bundle(__dirname + '/fixtures/json5/index.js');

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

  it('should minify JSON files', async function() {
    await bundle(__dirname + '/fixtures/uglify-json/index.json', {
      production: true
    });

    let json = await fs.readFile(__dirname + '/dist/index.js', 'utf8');
    assert(json.includes('{test:"test"}'));
  });

  it('should minify JSON5 files', async function() {
    await bundle(__dirname + '/fixtures/uglify-json5/index.json5', {
      production: true
    });

    let json = await fs.readFile(__dirname + '/dist/index.js', 'utf8');
    assert(json.includes('{test:"test"}'));
  });
});
