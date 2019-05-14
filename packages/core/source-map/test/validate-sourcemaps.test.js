// @flow
import assert from 'assert';

import SourceMap from '../src/SourceMap';

describe('Validate mappings', () => {
  it('Should be able to detect invalid mappings', async function() {
    assert.throws(() => {
      new SourceMap([
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
      new SourceMap([
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
      new SourceMap([
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
      new SourceMap([
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
      new SourceMap([
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
      new SourceMap([
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
      new SourceMap([
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
      new SourceMap([
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
