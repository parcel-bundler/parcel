const assert = require('assert');
const path = require('path');
const {bundle, run, assertBundles} = require('@parcel/test-utils');

describe('mdx', function () {
  it('should support bundling MDX', async function () {
    let b = await bundle(path.join(__dirname, '/integration/mdx/index.mdx'));

    let output = await run(b);
    assert.equal(typeof output.default, 'function');
    assert(output.default.isMDXComponent);
  });

  it('should support bundling MDX with React 17', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/mdx-react-17/index.mdx'),
    );

    let output = await run(b);
    assert.equal(typeof output.default, 'function');
    assert(output.default.isMDXComponent);
  });

  it.skip('should support merging types with sync children', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/merge-types-children/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'bundle-url.js',
          'cacheLoader.js',
          'css-loader.js',
          'esmodule-helpers.js',
          'js-loader.js',
          'bundle-manifest.js',
        ],
      },
      {
        assets: ['bar.js', 'foo.js', 'a.js', 'b,js'],
      },
      {
        assets: ['styles.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output.default, 'function');
    assert(output.default.isMDXComponent);
  });
});
