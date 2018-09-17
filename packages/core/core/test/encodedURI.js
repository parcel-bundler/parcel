const assert = require('assert');
const fs = require('../src/utils/fs');
const {bundle, assertBundleTree} = require('./utils');

describe('encodedURI', function() {
  it('should support bundling files which names in encoded URI', async function() {
    let b = await bundle(__dirname + '/integration/encodedURI/index.html');

    await assertBundleTree(b, {
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

    let files = await fs.readdir(__dirname + '/dist');
    let html = await fs.readFile(__dirname + '/dist/index.html');
    for (let file of files) {
      if (file !== 'index.html') {
        assert(html.includes(file));
      }
    }
  });
});
