const assert = require('assert');
const path = require('path');
const {bundle, assertBundles, outputFS} = require('@parcel/test-utils');

describe('markdown', function() {
  it.only('should support bundling Markdown', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/markdown/index.md')
    );

    await assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.md']
      },
      {
        type: 'png',
        assets: ['100x100.png']
      }
    ]);

    let files = await outputFS.readdir(path.join(__dirname, '/dist'));
    let html = await outputFS.readFile(
      path.join(__dirname, '/dist/index.html')
    );
    for (let file of files) {
      let ext = file.match(/\.([0-9a-z]+)(?:[?#]|$)/i)[0];
      if (file !== 'index.html' && ext !== '.map') {
        assert(html.includes(file));
      }
    }
  });
});
