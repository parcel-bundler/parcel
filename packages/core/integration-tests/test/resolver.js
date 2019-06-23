const assert = require('assert');
const path = require('path');
const {bundle, run} = require('@parcel/test-utils');

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
});
