const assert = require('assert');
const {bundle, run, assertBundleTree} = require('./utils');

describe('sugarss', function() {
  it('should correctly parse SugarSS asset', async function() {
    let b = await bundle(__dirname + '/integration/sugarss/index.js');

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'index.sss'],
      childBundles: [
        {
          type: 'map'
        },
        {
          name: 'index.css',
          assets: ['index.sss'],
          childBundles: []
        }
      ]
    });

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 2);

  })
})
