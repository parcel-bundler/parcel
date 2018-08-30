const assert = require('assert');
const {bundle, assertBundleTree, run} = require('./utils');
const process = require('process');

describe('elm', function() {
  before(function() {
    process.chdir(__dirname + '/integration/elm');
  });
    
  it('should produce a basic elm bundle', async function() {
    let b = await bundle(__dirname + '/integration/elm/index.js');

    await assertBundleTree(b, {
      type: 'js',
      assets: ['Main.elm', 'index.js']
    });

    let output = await run(b);
    assert.equal(typeof output().Elm.Main.init, 'function');
  });
});
