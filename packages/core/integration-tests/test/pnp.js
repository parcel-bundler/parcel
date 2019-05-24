const assert = require('assert');
const Module = require('module');
const path = require('path');
const {bundle, run, assertBundleTree} = require('@parcel/test-utils');

describe('pnp', function() {
  it('should defer to the pnp resolution when needed', async function() {
    const calls = [];

    const resolveToUnqualified = (request, issuer, opts) => {
      calls.push([request, issuer, opts]);

      if (request === `testmodule`) {
        return path.join(__dirname, '/integration/pnp_require/pnp/testmodule');
      } else {
        throw new Error(`Shouldn't be called`);
      }
    };

    const pnpapi = {resolveToUnqualified};

    const origPnpVersion = process.versions.pnp;
    process.versions.pnp = 42;

    const origModuleLoad = Module._load;
    Module._load = (name, ...args) =>
      name === `pnpapi` ? pnpapi : origModuleLoad(name, ...args);

    try {
      let b = await bundle(
        path.join(__dirname, '/integration/pnp_require/main.js')
      );

      await assertBundleTree(b, {
        name: 'main.js',
        assets: ['main.js', 'local.js', 'index.js']
      });

      assert.deepEqual(calls, [
        [
          'testmodule',
          path.join(__dirname, '/integration/pnp_require/main.js'),
          {considerBuiltins: false}
        ]
      ]);

      let output = await run(b);
      assert.equal(typeof output, 'function');
      assert.equal(output(), 3);
    } finally {
      process.versions.pnp = origPnpVersion;
      Module._load = origModuleLoad;
    }
  });
});
