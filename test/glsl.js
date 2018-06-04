const assert = require('assert');
const fs = require('../src/utils/fs');
const {bundle, run, assertBundleTree} = require('./utils');

describe('glsl', function() {
  it('should support requiring GLSL files via glslify', async function() {
    let b = await bundle(__dirname + '/integration/glsl/index.js');

    await assertBundleTree(b, {
      name: 'index.js',
      assets: ['index.js', 'local.glsl', 'local.vert', 'local.frag'],
      childBundles: [
        {
          type: 'map'
        }
      ]
    });

    let shader = await fs.readFile(
      __dirname + '/integration/glsl/compiled.glsl',
      'utf8'
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.ok(
      output().reduce((acc, requiredShader) => {
        return acc && shader === requiredShader;
      }, true)
    );
  });
});
