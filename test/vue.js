const assert = require('assert');
const {bundle, assertBundleTree} = require('./utils');

describe('vue', function() {
  it('should produce a vue bundle without errors', async function() {
    let b = await bundle(__dirname + '/integration/vue/index.html');

    assert.equal(b.assets.size, 1);
    assert.equal(b.childBundles.size, 1);

    assertBundleTree(b, {
      type: 'html',
      childBundles: [
        {
          assets: [
            'index.js',
            'App.vue',
            'basic.vue',
            'inject-style-client.js',
            'list-to-styles.js',
            'logo.png',
            'normalize-component.js',
            'vue.esm.js'
          ],
          type: 'js',
          childBundles: [
            {
              type: 'map'
            },
            {
              type: 'png'
            }
          ]
        }
      ]
    });
  });
});
