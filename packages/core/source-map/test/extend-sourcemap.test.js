// @flow
import assert from 'assert';

import SourceMap from '../src/SourceMap';

describe('SourceMap', () => {
  it('Basic extending', async function() {
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

  it('Extending null mapping', async function() {
    let map = new SourceMap([
      {
        source: 'index.js',
        name: 'A',
        original: null,
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
      original: null,
      generated: {
        line: 5,
        column: 12
      }
    });
  });
});
