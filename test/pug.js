const assert = require('assert');
const fs = require('fs');
const { bundle, run } = require('./utils');

describe('pug', function() {
  it('should support bundling Pug', async function() {
    let b = await bundle(__dirname + '/integration/pug/index.pug');

    assertBundleTree(b, {
      name: 'index.pug',
      assets: ['index.pug'],
      childBundles: [
        {
          type: 'js',
          assets: ['index.js'],
          childBundles: []
        },
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
