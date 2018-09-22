const assert = require('assert');
const path = require('path');
const fs = require('../src/utils/fs');
const {bundle, assertBundleTree} = require('./utils');

describe('encodedURI', function() {
  it('should support bundling files which names in encoded URI', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/encodedURI/index.html')
    );

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

    let files = await fs.readdir(path.join(__dirname, '/dist'));
    let html = await fs.readFile(path.join(__dirname, '/dist/index.html'));
    for (let file of files) {
      if (file !== 'index.html') {
        assert(html.includes(file));
      }
    }
  });
});
