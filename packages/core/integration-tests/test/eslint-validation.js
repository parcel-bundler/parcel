import assert from 'assert';
import path from 'path';
import {bundle} from '@parcel/test-utils';
import defaultConfigContents from '@parcel/config-default';

const config = {
  ...defaultConfigContents,
  validators: {
    '*.{js,jsx,ts,tsx}': ['@parcel/validator-eslint']
  },
  reporters: [],
  filePath: require.resolve('@parcel/config-default')
};

describe('eslint-validator', function() {
  it('should throw validation error with eslint errors', async function() {
    let didThrow = false;
    let entry = path.join(__dirname, '/integration/eslint-error/index.js');
    try {
      await bundle(entry, {
        defaultConfig: config
      });
    } catch (e) {
      assert.equal(e.name, 'BuildError');
      assert(!!Array.isArray(e.diagnostics));
      assert(!!e.diagnostics[0].codeFrame);
      assert.equal(e.diagnostics[0].origin, '@parcel/validator-eslint');
      assert.equal(
        e.diagnostics[0].message,
        'ESLint found **1** __errors__ and **0** __warnings__.'
      );
      assert.equal(e.diagnostics[0].filePath, entry);

      didThrow = true;
    }

    assert(didThrow);
  });
});
