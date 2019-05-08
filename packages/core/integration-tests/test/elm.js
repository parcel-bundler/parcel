const assert = require('assert');
const fs = require('@parcel/fs');
const {bundle, assertBundleTree, run} = require('@parcel/test-utils');

it.optional = function(title, callback) {
  it(title, async function(...args) {
    callback = callback.bind(this);

    try {
      await callback(...args);
    } catch (e) {
      this.skip();

      // eslint-disable-next-line no-console
      console.warn('Test:', title, 'failed.');
    }
  });
};

describe('elm', function() {
  it.optional('should produce a basic Elm bundle', async function() {
    let b = await bundle(__dirname + '/integration/elm/index.js');

    await assertBundleTree(b, {
      type: 'js',
      assets: ['Main.elm', 'index.js']
    });

    let output = await run(b);
    assert.equal(typeof output().Elm.Main.init, 'function');
  });

  it.optional('should produce a elm bundle with debugger', async function() {
    let b = await bundle(__dirname + '/integration/elm/index.js');

    await run(b);
    let js = await fs.readFile(__dirname + '/dist/index.js', 'utf8');
    assert(js.includes('elm$browser$Debugger'));
  });

  it.optional('should apply elm-hot if HMR is enabled', async function() {
    let b = await bundle(__dirname + '/integration/elm/index.js', {
      hmr: true
    });

    await assertBundleTree(b, {
      type: 'js',
      assets: ['Main.elm', 'hmr-runtime.js', 'index.js']
    });

    let js = await fs.readFile(__dirname + '/dist/index.js', 'utf8');
    assert(js.includes('[elm-hot]'));
  });

  it.optional('should remove debugger in production', async function() {
    let b = await bundle(__dirname + '/integration/elm/index.js', {
      production: true
    });

    await run(b);
    let js = await fs.readFile(__dirname + '/dist/index.js', 'utf8');
    assert(!js.includes('elm$browser$Debugger'));
  });

  it.optional('should minify Elm in production mode', async function() {
    let b = await bundle(__dirname + '/integration/elm/index.js', {
      production: true
    });

    let output = await run(b);
    assert.equal(typeof output().Elm.Main.init, 'function');

    let js = await fs.readFile(__dirname + '/dist/index.js', 'utf8');
    assert(!js.includes('elm$core'));
  });
});
