const assert = require('assert');
const fs = require('fs');
const {bundle, assertBundleTree} = require('./utils');

describe('pug', function() {
  it('should support bundling HTML', async function() {
    const b = await bundle(__dirname + '/integration/pug/index.pug');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.pug'],
      childBundles: [
        {
          type: 'png',
          assets: ['100x100.png'],
          childBundles: []
        },
        {
          type: 'svg',
          assets: ['icons.svg'],
          childBundles: []
        },
        {
          type: 'css',
          assets: ['index.css'],
          childBundles: []
        },
        {
          type: 'js',
          assets: ['index.js'],
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });

    const files = fs.readdirSync(__dirname + '/dist');
    const html = fs.readFileSync(__dirname + '/dist/index.html');
    for (const file of files) {
      const ext = file.match(/\.([0-9a-z]+)(?:[?#]|$)/i)[0];
      if (file !== 'index.html' && ext !== '.map') {
        assert(html.includes(file));
      }
    }
  });

  it('should support include and extends files', async function() {
    const b = await bundle(
      __dirname + '/integration/pug-include-extends/index.pug'
    );

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.pug']
    });

    const html = fs.readFileSync(__dirname + '/dist/index.html', 'utf-8');
    const expect = fs.readFileSync(
      __dirname + '/integration/pug-include-extends/expect.html',
      'utf-8'
    );

    assert.equal(html, expect, 'Content mismatch');
  });

  it('should support variables', async function() {
    const b = await bundle(__dirname + '/integration/pug-var/index.pug');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.pug']
    });

    const html = fs.readFileSync(__dirname + '/dist/index.html', 'utf-8');

    assert(/src="\/?100x100.*.png"/.test(html));
  });

  it('should support mixins', async function() {
    const b = await bundle(__dirname + '/integration/pug-mixins/index.pug');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.pug']
    });

    const html = fs.readFileSync(__dirname + '/dist/index.html', 'utf-8');
    assert(html.includes('Greetings, Parcel'));
  });

  it('should support filters', async function() {
    const b = await bundle(__dirname + '/integration/pug-filters/index.pug');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.pug']
    });

    const html = fs.readFileSync(__dirname + '/dist/index.html', 'utf-8');
    assert(html.includes('FILTERED: Hello!'));
  });

  it('should minify HTML in production mode', async function() {
    const b = await bundle(__dirname + '/integration/pug-minify/index.pug', {
      production: true
    });

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.pug']
    });

    const html = fs.readFileSync(__dirname + '/dist/index.html', 'utf-8');

    assert(html.includes('Minified'));
  });
});
