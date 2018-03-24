const assert = require('assert');
const {bundle, assertBundleTree} = require('./utils');

describe('vue', function() {
  it('should produce a basic vue bundle', async function() {
    let b = await bundle(__dirname + '/integration/vue-basic/index.html');

    assert.equal(b.assets.size, 1);
    assert.equal(b.childBundles.size, 1);

    assertBundleTree(b, {
      type: 'html',
      childBundles: [
        {
          assets: ['index.js', 'Basic.vue', 'vue.esm.js'],
          type: 'js',
          childBundles: [
            {
              type: 'map'
            }
          ]
        }
      ]
    });
  });

  it('should produce a vue bundle with dependencies', async function() {
    let b = await bundle(
      __dirname + '/integration/vue-dependencies/index.html'
    );

    assert.equal(b.assets.size, 1);
    assert.equal(b.childBundles.size, 1);

    assertBundleTree(b, {
      type: 'html',
      childBundles: [
        {
          assets: ['index.js', 'App.vue', 'logo.png', 'vue.esm.js'],
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

  it('should produce a vue bundle using preprocessors', async function() {
    let b = await bundle(
      __dirname + '/integration/vue-preprocessors/index.html'
    );

    assert.equal(b.assets.size, 1);
    assert.equal(b.childBundles.size, 1);

    assertBundleTree(b, {
      type: 'html',
      childBundles: [
        {
          assets: ['index.js', 'pre-processors.vue', 'logo.png', 'vue.esm.js'],
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
