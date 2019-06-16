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

    await map.extend(
      new SourceMap([
        {
          source: 'index.js',
          name: '',
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

    // Should be able to stringify the map without errors...
    assert.equal(
      await map.stringify({
        file: 'index.min.js',
        rootDir: '/root'
      }),
      '{"version":3,"sources":["index.js"],"names":["A"],"mappings":";;;;YAAAA","file":"index.min.js"}'
    );
  });

  it('Extending null mappings', async function() {
    let map = new SourceMap([
      {
        source: 'index.js',
        name: '',
        original: {
          line: 6,
          column: 15
        },
        generated: {
          line: 5,
          column: 12
        }
      },
      {
        generated: {
          line: 6,
          column: 15
        }
      }
    ]);

    await map.extend(
      new SourceMap([
        {
          source: 'index.js',
          name: '',
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

    assert.equal(map.mappings.length, 2);
    assert.deepEqual(map.mappings[0], {
      source: 'index.js',
      name: '',
      original: {
        line: 6,
        column: 15
      },
      generated: {
        line: 5,
        column: 12
      }
    });
    assert.deepEqual(map.mappings[1], {
      generated: {
        line: 5,
        column: 12
      }
    });

    // Should be able to stringify the map without errors...
    assert.equal(
      await map.stringify({
        file: 'index.min.js',
        rootDir: '/root'
      }),
      '{"version":3,"sources":["index.js"],"names":[""],"mappings":";;;;YAKeA,A","file":"index.min.js"}'
    );
  });
});
