const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mapValidator = require('sourcemap-validator');
const {bundle, run, assertBundleTree} = require('./utils');

describe('sourcemaps', function() {
  it('should create a valid sourcemap as a child of a JS bundle', async function() {
    let b = await bundle(__dirname + '/integration/sourcemap/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js'],
      childBundles: [
        {
          name: 'index.map',
          type: 'map'
        }
      ]
    });

    let raw = fs
      .readFileSync(path.join(__dirname, '/dist/index.js'))
      .toString();
    let map = fs
      .readFileSync(path.join(__dirname, '/dist/index.map'))
      .toString();
    mapValidator(raw, map);

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 'hello world');
  });

  it('should create a valid sourcemap as a child of a TS bundle', async function() {
    let b = await bundle(
      __dirname + '/integration/sourcemap-typescript/index.ts'
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.ts'],
      childBundles: [
        {
          name: 'index.map',
          type: 'map'
        }
      ]
    });

    let raw = fs
      .readFileSync(path.join(__dirname, '/dist/index.js'))
      .toString();
    let map = fs
      .readFileSync(path.join(__dirname, '/dist/index.map'))
      .toString();
    mapValidator(raw, map);

    let output = run(b);
    assert.equal(typeof output.env, 'function');
    assert.equal(output.env(), process.env.NODE_ENV);
  });

  it('should create a valid sourcemap as a child of a nested TS bundle', async function() {
    let b = await bundle(
      __dirname + '/integration/sourcemap-typescript-nested/index.ts'
    );

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.ts', 'local.ts'],
      childBundles: [
        {
          name: 'index.map',
          type: 'map'
        }
      ]
    });

    let raw = fs
      .readFileSync(path.join(__dirname, '/dist/index.js'))
      .toString();
    let map = fs
      .readFileSync(path.join(__dirname, '/dist/index.map'))
      .toString();
    mapValidator(raw, map);

    let output = run(b);
    assert.equal(typeof output.env, 'function');
    assert.equal(output.env(), process.env.NODE_ENV);
  });

  it('should create a valid sourcemap for a js file with requires', async function() {
    let b = await bundle(__dirname + '/integration/sourcemap-nested/index.js');

    assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.js', 'util.js'],
      childBundles: [
        {
          name: 'index.map',
          type: 'map'
        }
      ]
    });

    let raw = fs
      .readFileSync(path.join(__dirname, '/dist/index.js'))
      .toString();
    let map = fs
      .readFileSync(path.join(__dirname, '/dist/index.map'))
      .toString();
    mapValidator(raw, map);

    let output = run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 14);
  });
});
