import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';
import defaultConfigContents from '@parcel/config-default';

const config = {
  ...defaultConfigContents,
  validators: {
    '*.{ts,tsx}': ['@parcel/validator-typescript']
  },
  reporters: ['@parcel/reporter-cli'],
  filePath: require.resolve('@parcel/config-default')
};

// For some reason this throws uncaught after passing...
describe.skip('ts-validator', function() {
  it('should throw validation error on typescript typing errors', async function() {
    let didThrow = false;
    let entry = path.join(
      __dirname,
      '/integration/ts-validation-error/index.ts'
    );
    try {
      await bundle(entry, {
        defaultConfig: config,
        logLevel: 'info'
      });
    } catch (e) {
      assert.equal(e.name, 'BuildError');
      assert(!!Array.isArray(e.diagnostic));
      assert(!!e.diagnostic[0].codeFrame);
      assert.equal(e.diagnostic[0].origin, '@parcel/validator-typescript');
      assert.equal(
        e.diagnostic[0].message,
        `Property 'world' does not exist on type 'Params'.`
      );
      assert.equal(e.diagnostic[0].filePath, entry);

      didThrow = true;
    }

    assert(didThrow);
  });
});
