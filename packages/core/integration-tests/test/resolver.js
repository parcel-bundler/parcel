const assert = require('assert');
const path = require('path');
const {bundle, run} = require('@parcel/test-utils');

describe('resolver', function() {
  it('should support resolve tilde in monorepos', async function() {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/resolve-tilde-monorepo/client/src/index.js'
      )
    );

    let output = await run(b);
    assert.strictEqual(output.default, 1234);
  });
});
