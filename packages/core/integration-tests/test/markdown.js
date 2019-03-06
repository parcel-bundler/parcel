const assert = require('assert');
const path = require('path');
const fs = require('@parcel/fs');
const {bundle, assertBundleTree} = require('@parcel/test-utils');

describe('markdown', function() {
  it('should support bundling Markdown', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/markdown/index.md')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.md'],
      childBundles: [
        {
          type: 'png',
          assets: ['100x100.png'],
          childBundles: []
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
