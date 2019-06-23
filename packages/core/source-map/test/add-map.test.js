// @flow

import assert from 'assert';

import SourceMap from '../src/SourceMap';

describe('Add Map', () => {
  it('addMap with null mappings', async function() {
    // Output file length = 23 lines
    const MAP_OFFSET = 24;
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
      },
      {
        source: 'index.js',
        name: 'B',
        original: {
          line: 3,
          column: 0
        },
        generated: {
          line: 12,
          column: 6
        }
      }
    ]);

    let secondMap = new SourceMap([
      {
        source: 'local.js',
        name: 'T',
        original: {
          line: 1,
          column: 0
        },
        generated: {
          line: 12,
          column: 6
        }
      },
      {
        source: 'local.js',
        name: 'Q',
        original: {
          line: 1,
          column: 0
        },
        generated: {
          line: 111,
          column: 65
        }
      },
      {
        generated: {
          line: 152,
          column: 23
        }
      }
    ]);

    await map.addMap(secondMap, MAP_OFFSET);

    assert.equal(map.mappings.length, 5);

    // Map One
    assert.deepEqual(map.mappings[0], {
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
    });
    assert.deepEqual(map.mappings[1], {
      source: 'index.js',
      name: 'B',
      original: {
        line: 3,
        column: 0
      },
      generated: {
        line: 12,
        column: 6
      }
    });

    // Map Two
    assert.deepEqual(map.mappings[2], {
      source: 'local.js',
      name: 'T',
      original: {
        line: 1,
        column: 0
      },
      generated: {
        line: 12 + MAP_OFFSET,
        column: 6
      }
    });
    assert.deepEqual(map.mappings[3], {
      source: 'local.js',
      name: 'Q',
      original: {
        line: 1,
        column: 0
      },
      generated: {
        line: 111 + MAP_OFFSET,
        column: 65
      }
    });
    assert.deepEqual(map.mappings[4], {
      generated: {
        line: 152 + MAP_OFFSET,
        column: 23
      }
    });

    // Should be able to stringify the map without errors...
    assert.equal(
      await map.stringify({
        file: 'index.min.js',
        rootDir: '/root'
      }),
      '{"version":3,"sources":["index.js","local.js"],"names":["A","B","T","Q"],"mappings":";;;;;eAAAA;;;;;;MAEAC;;;;;;;;;;;;;;;;;;;;;;;;MCFAC;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;iEAAAC;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;uB","file":"index.min.js"}'
    );
  });
});
