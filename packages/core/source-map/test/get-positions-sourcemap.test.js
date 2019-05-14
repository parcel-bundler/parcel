// @flow
import assert from 'assert';
import clone from 'clone';

import SourceMap from '../src/SourceMap';

const BASIC_TEST_MAPPINGS = [
  {
    source: 'a.js',
    name: 'A',
    original: {
      line: 1,
      column: 156
    },
    generated: {
      line: 6,
      column: 15
    }
  },
  {
    source: 'b.js',
    name: 'B',
    original: {
      line: 2,
      column: 27
    },
    generated: {
      line: 7,
      column: 25
    }
  }
];

const NULL_MAPPING = {
  source: 'null.js',
  name: 'N',
  original: null,
  generated: {
    line: 10,
    column: 45
  }
};

describe('Get Sourcemap Position', () => {
  it('get original position linked to a generated position', async function() {
    let map = new SourceMap(clone([...BASIC_TEST_MAPPINGS]));

    let originalPositionOne = map.originalPositionFor({
      line: 6,
      column: 15
    });

    let originalPositionTwo = map.originalPositionFor({
      line: 7,
      column: 25
    });

    assert.deepEqual(originalPositionOne, {
      source: 'a.js',
      name: 'A',
      line: 1,
      column: 156
    });

    assert.deepEqual(originalPositionTwo, {
      source: 'b.js',
      name: 'B',
      line: 2,
      column: 27
    });
  });

  it('get original position linked to non exact mappings', async function() {
    let map = new SourceMap(clone([...BASIC_TEST_MAPPINGS]));

    let originalPositionOne = map.originalPositionFor({
      line: 6,
      column: 18
    });

    let originalPositionTwo = map.originalPositionFor({
      line: 7,
      column: 27
    });

    assert.deepEqual(originalPositionOne, {
      source: 'a.js',
      name: 'A',
      line: 1,
      column: 156
    });

    assert.deepEqual(originalPositionTwo, {
      source: 'b.js',
      name: 'B',
      line: 2,
      column: 27
    });
  });

  it('get original position linked to a generated position with a null mapping', async function() {
    let map = new SourceMap(clone([...BASIC_TEST_MAPPINGS, NULL_MAPPING]));

    let originalPositionOne = map.originalPositionFor({
      line: 6,
      column: 15
    });

    let originalPositionTwo = map.originalPositionFor({
      line: 7,
      column: 25
    });

    let originalPositionThree = map.originalPositionFor({
      line: 10,
      column: 45
    });

    assert.deepEqual(originalPositionOne, {
      source: 'a.js',
      name: 'A',
      line: 1,
      column: 156
    });

    assert.deepEqual(originalPositionTwo, {
      source: 'b.js',
      name: 'B',
      line: 2,
      column: 27
    });

    assert.deepEqual(originalPositionThree, {
      source: 'null.js',
      name: 'N',
      line: null,
      column: null
    });
  });

  it('get generated position linked to an original position', async function() {
    let map = new SourceMap(clone([...BASIC_TEST_MAPPINGS]));

    let originalPositionOne = map.generatedPositionFor({
      line: 1,
      column: 156
    });

    let originalPositionTwo = map.generatedPositionFor({
      line: 2,
      column: 27
    });

    assert.deepEqual(originalPositionOne, {
      source: 'a.js',
      name: 'A',
      line: 6,
      column: 15
    });

    assert.deepEqual(originalPositionTwo, {
      source: 'b.js',
      name: 'B',
      line: 7,
      column: 25
    });
  });

  it('get generated position linked to an original position with a null mapping', async function() {
    let map = new SourceMap(clone([...BASIC_TEST_MAPPINGS, NULL_MAPPING]));

    let originalPositionOne = map.generatedPositionFor({
      line: 1,
      column: 156
    });

    let originalPositionTwo = map.generatedPositionFor({
      line: 2,
      column: 27
    });

    assert.deepEqual(originalPositionOne, {
      source: 'a.js',
      name: 'A',
      line: 6,
      column: 15
    });

    assert.deepEqual(originalPositionTwo, {
      source: 'b.js',
      name: 'B',
      line: 7,
      column: 25
    });
  });

  it('null mapping in the middle', async function() {
    let map = new SourceMap([
      {
        source: 'a.js',
        name: 'A',
        original: {
          line: 1,
          column: 156
        },
        generated: {
          line: 5,
          column: 76
        }
      },
      {
        source: 'null.js',
        name: 'N',
        original: null,
        generated: {
          line: 7,
          column: 25
        }
      },
      {
        source: 'b.js',
        name: 'B',
        original: {
          line: 8,
          column: 27
        },
        generated: {
          line: 10,
          column: 76
        }
      }
    ]);

    let originalPositionOne = map.generatedPositionFor({
      line: 1,
      column: 156
    });

    let originalPositionTwo = map.generatedPositionFor({
      line: 8,
      column: 27
    });

    assert.deepEqual(originalPositionOne, {
      source: 'a.js',
      name: 'A',
      line: 5,
      column: 76
    });

    assert.deepEqual(originalPositionTwo, {
      source: 'b.js',
      name: 'B',
      line: 10,
      column: 76
    });
  });

  it('multiple null mapping in the middle', async function() {
    let map = new SourceMap([
      {
        source: 'a.js',
        name: 'A',
        original: {
          line: 1,
          column: 156
        },
        generated: {
          line: 5,
          column: 76
        }
      },
      {
        source: 'null.js',
        name: 'N',
        original: null,
        generated: {
          line: 7,
          column: 25
        }
      },
      {
        source: 'null.js',
        name: 'NN',
        original: null,
        generated: {
          line: 8,
          column: 76
        }
      },
      {
        source: 'null.js',
        name: 'NNN',
        original: null,
        generated: {
          line: 9,
          column: 76
        }
      },
      {
        source: 'b.js',
        name: 'B',
        original: {
          line: 8,
          column: 27
        },
        generated: {
          line: 10,
          column: 76
        }
      }
    ]);

    let originalPositionOne = map.generatedPositionFor({
      line: 1,
      column: 156
    });

    let originalPositionTwo = map.generatedPositionFor({
      line: 8,
      column: 27
    });

    assert.deepEqual(originalPositionOne, {
      source: 'a.js',
      name: 'A',
      line: 5,
      column: 76
    });

    assert.deepEqual(originalPositionTwo, {
      source: 'b.js',
      name: 'B',
      line: 10,
      column: 76
    });
  });

  it('multiple null mapping intervalled with non-null mappings', async function() {
    let map = new SourceMap([
      {
        source: 'a.js',
        name: 'A',
        original: {
          line: 1,
          column: 156
        },
        generated: {
          line: 5,
          column: 76
        }
      },
      {
        source: 'null.js',
        name: 'N',
        original: null,
        generated: {
          line: 7,
          column: 25
        }
      },
      {
        source: 'null.js',
        name: 'NN',
        original: null,
        generated: {
          line: 8,
          column: 76
        }
      },
      {
        source: 'b.js',
        name: 'B',
        original: {
          line: 9,
          column: 156
        },
        generated: {
          line: 10,
          column: 76
        }
      },
      {
        source: 'null.js',
        name: 'NNN',
        original: null,
        generated: {
          line: 10,
          column: 76
        }
      },
      {
        source: 'b.js',
        name: 'B',
        original: {
          line: 12,
          column: 27
        },
        generated: {
          line: 16,
          column: 78
        }
      }
    ]);

    let originalPositionOne = map.generatedPositionFor({
      line: 1,
      column: 156
    });

    let originalPositionTwo = map.generatedPositionFor({
      line: 9,
      column: 156
    });

    let originalPositionThree = map.generatedPositionFor({
      line: 12,
      column: 27
    });

    assert.deepEqual(originalPositionOne, {
      source: 'a.js',
      name: 'A',
      line: 5,
      column: 76
    });

    assert.deepEqual(originalPositionTwo, {
      source: 'b.js',
      name: 'B',
      line: 10,
      column: 76
    });

    assert.deepEqual(originalPositionThree, {
      source: 'b.js',
      name: 'B',
      line: 16,
      column: 78
    });
  });

  it('should find closest column in a line', async function() {
    let map = new SourceMap([
      {
        source: 'a.js',
        name: 'A',
        original: {
          line: 1,
          column: 254
        },
        generated: {
          line: 5,
          column: 76
        }
      },
      {
        source: 'a.js',
        name: 'A',
        original: {
          line: 1,
          column: 476
        },
        generated: {
          line: 5,
          column: 154
        }
      },
      {
        source: 'a.js',
        name: 'A',
        original: {
          line: 1,
          column: 563
        },
        generated: {
          line: 5,
          column: 265
        }
      },
      {
        source: 'null.js',
        name: 'N',
        original: null,
        generated: {
          line: 7,
          column: 25
        }
      },
      {
        source: 'null.js',
        name: 'NN',
        original: null,
        generated: {
          line: 8,
          column: 76
        }
      },
      {
        source: 'b.js',
        name: 'B',
        original: {
          line: 9,
          column: 15
        },
        generated: {
          line: 10,
          column: 76
        }
      },
      {
        source: 'b.js',
        name: 'B',
        original: {
          line: 9,
          column: 276
        },
        generated: {
          line: 10,
          column: 165
        }
      },
      {
        source: 'b.js',
        name: 'B',
        original: {
          line: 9,
          column: 817
        },
        generated: {
          line: 10,
          column: 625
        }
      },
      {
        source: 'null.js',
        name: 'NNN',
        original: null,
        generated: {
          line: 10,
          column: 76
        }
      },
      {
        source: 'b.js',
        name: 'B',
        original: {
          line: 12,
          column: 27
        },
        generated: {
          line: 16,
          column: 78
        }
      }
    ]);

    let originalPositionOne = map.generatedPositionFor({
      line: 1,
      column: 375
    });

    let originalPositionTwo = map.generatedPositionFor({
      line: 9,
      column: 180
    });

    let originalPositionThree = map.generatedPositionFor({
      line: 12,
      column: 65
    });

    assert.deepEqual(originalPositionOne, {
      source: 'a.js',
      name: 'A',
      line: 5,
      column: 154
    });

    assert.deepEqual(originalPositionTwo, {
      source: 'b.js',
      name: 'B',
      line: 10,
      column: 165
    });

    assert.deepEqual(originalPositionThree, {
      source: 'b.js',
      name: 'B',
      line: 16,
      column: 78
    });
  });
});
