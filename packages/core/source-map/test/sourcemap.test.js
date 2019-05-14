// @flow
import assert from 'assert';
// import {SourceMapConsumer} from 'source-map';

import SourceMap from '../src/SourceMap';

describe('SourceMap', () => {
  it.skip('Should be able to detect invalid mappings', async function() {
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

  it('Should extend sourcemaps properly', async function() {
    let map = new SourceMap([
      {
        source: 'index.js',
        name: 'A',
        original: {
          line: 1,
          column: 0
        },
        generated: {
          line: 6,
          column: 15
        }
      }
    ]);

    await map.extendSourceMap(
      new SourceMap([
        {
          source: 'index.js',
          name: null,
          original: {
            line: 6,
            column: 15
          },
          generated: {
            line: 5,
            column: 12
          }
        }
      ])
    );

    assert.equal(map.mappings.length, 1);
    assert.deepEqual(map.mappings[0], {
      source: 'index.js',
      name: 'A',
      original: {
        line: 1,
        column: 0
      },
      generated: {
        line: 5,
        column: 12
      }
    });
  });
});
