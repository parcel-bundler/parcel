const assert = require('assert');
const SourceMap = require('../src/SourceMap');

describe('sourcemaps', function() {
  it('should purify mappings properly', async function() {
    let mappings = [
      {
        source: 'index.js',
        name: 'A',
        original: {
          line: 0,
          column: 0
        },
        generated: {
          line: 0,
          column: 0
        }
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: null,
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: null,
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 0,
          column: 0
        },
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 1,
          column: 0
        },
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 1,
          column: 0
        },
        source: 'index.js',
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 0,
          column: 0
        },
        source: 'index.js',
        name: null
      },
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
    ];

    let expectedResult = [
      {
        generated: {
          line: 1,
          column: 0
        },
        original: null,
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: null,
        source: null,
        name: null
      },
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 1,
          column: 0
        },
        source: 'index.js',
        name: null
      },
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
    ];

    let sourcemap = new SourceMap(mappings, {});
    assert.deepEqual(sourcemap.mappings, expectedResult);
  });

  it('should be able to handle null mappings properly', async function() {
    let mappings = [
      {
        generated: {
          line: 1,
          column: 0
        },
        original: {
          line: 1,
          column: 0
        },
        source: 'input.js',
        name: 'console'
      },
      {
        generated: {
          line: 1,
          column: 7
        },
        original: null,
        source: null,
        name: null
      }
    ];

    let sources = {
      'input.js': 'console.log("hello world!");'
    };

    let sourcemap = new SourceMap(mappings, sources);
    assert.equal(sourcemap.mappings.length, 2);
    assert.deepEqual(sourcemap.mappings, mappings);

    let mapString = sourcemap.stringify('index.map', '/');
    let combinedSourcemap = new SourceMap(mappings, sources);
    await combinedSourcemap.addMap(mapString);

    let newMapString = combinedSourcemap.stringify('index.map', '/');
    assert.equal(mapString, newMapString);

    let newSourcemap = new SourceMap([], {});
    await newSourcemap.addMap(sourcemap);

    assert.deepEqual(newSourcemap.mappings, mappings);

    newSourcemap = new SourceMap([], {});
    await newSourcemap.addMap(mapString);

    assert.deepEqual(newSourcemap.mappings, mappings);
  });
});
