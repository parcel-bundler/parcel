import assert from 'assert';
import path from 'path';
import {assertBundles, bundle, run} from '@parcel/test-utils';

describe('globals', function () {
  it('should support global alias syntax', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/global-alias/index.js'),
    );

    assert.equal(
      await run(b, {
        React: {
          createElement: function () {
            return 'ok';
          },
        },
      }),
      'ok',
    );
  });

  it('should insert global variables when needed', async function () {
    let b = await bundle(path.join(__dirname, '/integration/globals/index.js'));

    let output = await run(b);
    assert.deepEqual(output(), {
      dir: 'integration/globals',
      file: 'integration/globals/index.js',
      buf: Buffer.from('browser').toString('base64'),
      global: true,
    });
  });

  it('should work when multiple files use globals with scope hoisting', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/globals/multiple.js'),
      {
        mode: 'production',
        defaultTargetOptions: {
          shouldScopeHoist: true,
          shouldOptimize: false,
        },
      },
    );

    let output = await run(b);
    assert.deepEqual(output, {
      file: 'integration/globals/multiple.js',
      other: 'integration/globals/index.js',
    });
  });

  it('should not insert global variables when used in a module specifier', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/globals-module-specifier/a.js'),
    );

    assertBundles(b, [
      {
        assets: ['a.js', 'b.js', 'c.js', 'esmodule-helpers.js'],
      },
    ]);

    let output = await run(b);
    assert.deepEqual(output, 1234);
  });

  it('should not insert global variables in dead branches', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/globals-unused/a.js'),
    );

    assertBundles(b, [
      {
        assets: ['a.js'],
      },
    ]);

    let output = await run(b);
    assert.deepEqual(output, 'foo');
  });

  it('should handle re-declaration of the global constant', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/global-redeclare/index.js'),
    );

    let output = await run(b);
    assert.deepEqual(output(), false);
  });
});
