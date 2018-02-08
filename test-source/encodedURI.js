const assert = require('assert');
const fs = require('fs');
const {bundle, assertBundleTree} = require('./utils');

describe('encodedURI', function() {
  it('should support bundling files which names in encoded URI', async function() {
    let b = await bundle(__dirname + '/integration/encodedURI/index.html');

    assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.html'],
      childBundles: [
        {
          type: 'jpg',
          assets: ['日本語.jpg'],
          childBundles: []
        }
      ]
    });

    let files = fs.readdirSync(__dirname + '/dist');
    let html = fs.readFileSync(__dirname + '/dist/index.html');
    for (let file of files) {
      if (file !== 'index.html') {
        assert(html.includes(file));
      }
    }
  });
});
