const assert = require('assert');
const {bundle, assertBundleTree} = require('./utils');
const fs = require('../src/utils/fs');
const path = require('path');

describe('sugarss', function() {
  it('should correctly parse SugarSS asset', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/sugarss/index.sss')
    );

    await assertBundleTree(b, {
      name: 'index.css',
      assets: ['index.sss']
    });

    let cssContent = await fs.readFile(
      path.join(__dirname, '/dist/index.css'),
      'utf8'
    );
    assert(cssContent.includes('{'));
  });
});
