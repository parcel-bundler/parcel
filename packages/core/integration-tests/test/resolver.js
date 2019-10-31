import assert from 'assert';
import path from 'path';
import {bundle, run} from '@parcel/test-utils';

describe('resolver', function() {
  it('should support resolving tilde in monorepo packages', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-tilde-monorepo/client/src/index.js'
      )
    );

    let output = await run(b);
    assert.strictEqual(output.default, 1234);
  });

  it('should correctly resolve tilde in node_modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolve-tilde-nodemodules/index.js')
    );

    let output = await run(b);
    assert.strictEqual(output.default, 1234);
  });

  it('should throw an error on Webpack loader imports', async function() {
    let didThrow = false;
    try {
      await bundle(
        path.join(
          __dirname,
          '/integration/webpack-import-syntax-error/index.js'
        )
      );
    } catch (e) {
      didThrow = true;
      assert.equal(
        e.message,
        `The import path: node-loader!./index.js is using webpack specific loader import syntax, which isn't supported by Parcel.`
      );
    }

    assert(didThrow);
  });
});
