import assert from 'assert';
import path from 'path';
import {bundle, normalizeFilePath} from '@parcel/test-utils';
import defaultConfigContents from '@parcel/config-default';

const config = {
  ...defaultConfigContents,
  validators: {
    '*.{ts,tsx}': ['@parcel/validator-typescript']
  },
  reporters: [],
  filePath: require.resolve('@parcel/config-default')
};

describe('ts-validator', function() {
  it('should throw validation error on typescript typing errors', async function() {
    let didThrow = false;
    let entry = normalizeFilePath(
      path.join(__dirname, '/integration/ts-validation-error/index.ts')
    );
    try {
      await bundle(entry, {
        defaultConfig: config
      });
    } catch (e) {
      assert.equal(e.name, 'BuildError');
      assert(!!Array.isArray(e.diagnostics));
      assert(!!e.diagnostics[0].codeFrame);
      assert.equal(e.diagnostics[0].origin, '@parcel/validator-typescript');
      assert.equal(
        e.diagnostics[0].message,
        `Property 'world' does not exist on type 'Params'.`
      );
      assert.equal(e.diagnostics[0].filePath, entry);

      didThrow = true;
    }

    assert(didThrow);
  });
});
