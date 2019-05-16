// @flow
import assert from 'assert';

import validateMappings from '../src/validateMappings';

describe('Validate mappings', () => {
  it('Should be able to detect invalid mappings', async function() {
    assert.throws(() => {
      validateMappings([
        {
          source: 'index.js',
          name: 'A',
          original: {
            line: 0,
            column: 0
          },
          generated: {
            line: 1,
            column: 0
          }
        }
      ]);
    });

    assert.throws(() => {
      validateMappings([
        {
          source: 'index.js',
          name: 'A',
          original: {
            line: 1,
            column: 0
          },
          generated: {
            line: 0,
            column: 0
          }
        }
      ]);
    });

    assert.throws(() => {
      validateMappings([
        {
          source: null,
          name: 'A',
          original: {
            line: 1,
            column: 0
          },
          generated: {
            line: 1,
            column: 0
          }
        }
      ]);
    });

    assert.doesNotThrow(() => {
      validateMappings([
        {
          source: 'index.js',
          name: 'A',
          original: {
            line: 1,
            column: 18
          },
          generated: {
            line: 4,
            column: 187
          }
        }
      ]);
    });

    assert.doesNotThrow(() => {
      validateMappings([
        {
          source: 'index.js',
          name: 'A',
          original: {
            line: 1,
            column: 18
          },
          generated: {
            line: 4,
            column: 187
          }
        }
      ]);
    });

    assert.doesNotThrow(() => {
      validateMappings([
        {
          source: 'index.js',
          name: null,
          original: {
            line: 1,
            column: 0
          },
          generated: {
            line: 4,
            column: 0
          }
        }
      ]);
    });

    assert.doesNotThrow(() => {
      validateMappings([
        {
          source: 'index.js',
          name: null,
          original: {
            line: 2,
            column: 0
          },
          generated: {
            line: 1,
            column: 0
          }
        }
      ]);
    });

    assert.doesNotThrow(() => {
      validateMappings([
        {
          source: 'index.js',
          name: null,
          original: {
            line: 1,
            column: 0
          },
          generated: {
            line: 1,
            column: 0
          }
        }
      ]);
    });
  });
});
