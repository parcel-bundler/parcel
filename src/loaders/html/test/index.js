const assert = require('assert');
const fs = require('@parcel/fs');
const path = require('path');
const {bundle, run, assertBundleTree, deferred} = require('@parcel/test-utils');
const {mkdirp} = require('@parcel/fs');

describe('html loader', function () {
  it('should support importing HTML from JS async', async function() {
    let b = await bundle(
      __dirname + '/fixtures/import-html-async/index.js',
      {sourceMaps: false}
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'bundle-loader.js',
        'bundle-url.js',
        'html-loader-browser.js'
      ],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: []
            },
            {
              type: 'css',
              assets: ['index.css'],
              childBundles: []
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it('should support importing HTML from JS async with --target=node', async function() {
    let b = await bundle(
      __dirname + '/fixtures/import-html-async/index.js',
      {
        target: 'node',
        sourceMaps: false
      }
    );

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'bundle-loader.js',
        'bundle-url.js',
        'html-loader-node.js'
      ],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: []
            },
            {
              type: 'css',
              assets: ['index.css'],
              childBundles: []
            }
          ]
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });

  it('should support importing HTML from JS sync', async function() {
    let b = await bundle(__dirname + '/fixtures/import-html-sync/index.js', {
      sourceMaps: false
    });

    await assertBundleTree(b, {
      name: 'index.js',
      assets: [
        'index.js',
        'bundle-loader.js',
        'bundle-url.js',
        'html-loader-browser.js'
      ],
      childBundles: [
        {
          type: 'html',
          assets: ['other.html'],
          childBundles: [
            {
              type: 'png',
              assets: ['100x100.png'],
              childBundles: []
            },
            {
              type: 'css',
              assets: ['index.css'],
              childBundles: []
            }
          ]
        }
      ]
    });

    let promise = deferred();
    await run(b, {output: promise.resolve}, {require: false});
    let output = await promise;
    assert.equal(typeof output, 'string');
    assert(output.includes('<html>'));
    assert(output.includes('Other page'));
  });
});
