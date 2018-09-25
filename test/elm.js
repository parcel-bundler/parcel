const assert = require('assert');
const fs = require('../src/utils/fs');
const {bundle, assertBundleTree, run} = require('./utils');

describe('elm', function() {
  it('should produce a basic Elm bundle', async function() {
    let b = await bundle(__dirname + '/integration/elm/index.js');

    await assertBundleTree(b, {
      type: 'js',
      assets: ['Main.elm', 'index.js']
    });

    let output = await run(b);
    assert.equal(typeof output().Elm.Main.init, 'function');
  });

  it('should minify Elm in production mode', async function() {
    let b = await bundle(__dirname + '/integration/elm/index.js', {
      production: true
    });

    let output = await run(b);
    assert.equal(typeof output().Elm.Main.init, 'function');

    let js = await fs.readFile(__dirname + '/dist/index.js', 'utf8');
    assert(!js.includes('elm$core'));
  });
});
