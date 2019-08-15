// @flow
import assert from 'assert';

import validateModuleSpecifiers from '../src/validateModuleSpecifiers';

describe('Validate Module Specifiers', () => {
  it('Validate Module Specifiers', () => {
    let modules = [
      '@parcel/transformer-posthtml/package.json',
      '@some-org/package@v1.0.0',
      '@org/some-package@v1.0.0-alpha.1',
      'lodash/something/index.js'
    ];

    assert.deepEqual(validateModuleSpecifiers(modules), [
      '@parcel/transformer-posthtml',
      '@some-org/package@v1.0.0',
      '@org/some-package@v1.0.0-alpha.1',
      'lodash'
    ]);
  });
});
