const assert = require('assert');
const fs = require('fs');
const {bundle, assertBundleTree} = require('./utils');

describe('parser', function() {
  it('should support case-insensitive file extension', async function() {
    let b = await bundle(
      __dirname + '/integration/parser-case-insensitive-ext/index.html'
    );

    assertBundleTree(b, {
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

    let files = fs.readdirSync(__dirname + '/dist');
    let html = fs.readFileSync(__dirname + '/dist/index.html');
    for (let file of files) {
      let ext = file.match(/\.([0-9a-z]+)(?:[?#]|$)/i)[0];
      if (file !== 'index.html' && ext !== '.map') {
        assert(html.includes(file));
      }
    }
  });
});
