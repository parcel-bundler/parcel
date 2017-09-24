const assert = require('assert');
const fs = require('fs');
const {bundle, run, assertBundleTree} = require('./utils');

describe('html', function () {
  it('should support bundling HTML', async function () {
    let b = await bundle(__dirname + '/integration/html/index.html');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [{
        type: 'css',
        assets: ['index.css'],
        childBundles: []
      }, {
        type: 'html',
        assets: ['other.html'],
        childBundles: [{
          type: 'js',
          assets: ['index.js'],
          childBundles: []
        }]
      }]
    });

    let files = fs.readdirSync(__dirname + '/dist');
    let html = fs.readFileSync(__dirname + '/dist/index.html');
    for (let file of files) {
      if (file !== 'index.html') {
        assert(html.includes(file));
      }
    }
  });

  it('should support transforming HTML with posthtml', async function () {
    let b = await bundle(__dirname + '/integration/posthtml/index.html');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: []
    });

    let html = fs.readFileSync(__dirname + '/dist/index.html');
    assert(html.includes('<h1>Other page</h1>'));
  });

  it('should insert sibling CSS bundles for JS files in the HEAD', async function () {
    let b = await bundle(__dirname + '/integration/html-css/index.html');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [{
        type: 'js',
        assets: ['index.js', 'index.css'],
        childBundles: [{
          type: 'css',
          assets: ['index.css'],
          childBundles: []
        }]
      }]
    });

    let html = fs.readFileSync(__dirname + '/dist/index.html');
    assert(/<link rel="stylesheet" href="\/dist\/[a-f0-9]+\.css">/.test(html));
  });

  it('should minify HTML in production mode', async function () {
    let b = await bundle(__dirname + '/integration/htmlnano/index.html', {production: true});

    let css = fs.readFileSync(__dirname + '/dist/index.html', 'utf8');
    assert(css.includes('Other page'));
    assert(!css.includes('\n'));
  });
});
