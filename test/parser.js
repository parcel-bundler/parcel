const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const {bundle, assertBundleTree} = require('./utils');

describe('parser', function() {
  it('should support case-insensitive file extension', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/parser-case-insensitive-ext/index.html'
      )
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'svg',
          assets: ['icons.SVG'],
          childBundles: []
        },
        {
          type: 'css',
          assets: ['index.cSs'],
          childBundles: []
        },
        {
          type: 'html',
          assets: ['other.HTM'],
          childBundles: [
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
        }
      ]
    });

    let files = await fs.readdir(path.join(__dirname, '/dist'));
    let html = await fs.readFile(path.join(__dirname, '/dist/index.html'));
    for (let file of files) {
      let ext = file.match(/\.([0-9a-z]+)(?:[?#]|$)/i)[0];
      if (file !== 'index.html' && ext !== '.map') {
        assert(html.includes(file));
      }
    }
  });
});
