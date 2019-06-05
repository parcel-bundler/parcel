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

    // Should be able to stringify the map without errors...
    await map.stringify({file: 'index.min.js', rootDir: '/root'});
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

    // Should be able to stringify the map without errors...
    assert.equal(
      await map.stringify({
        file: 'index.min.js',
        rootDir: '/root'
      }),
      '{"version":3,"sources":["a.js","b.js"],"names":["A","B"],"mappings":";;;;;eAA4JA;yBCCjIC","file":"index.min.js"}'
    );
  });

  it('get original position of null mappings (aka return null)', async function() {
    let map = new SourceMap(
      clone([
        ...BASIC_TEST_MAPPINGS,
        {
          generated: {
            line: 7,
            column: 65
          }
        }
      ])
    );

    let originalPositionOne = map.originalPositionFor({
      line: 6,
      column: 18
    });

    let originalPositionTwo = map.originalPositionFor({
      line: 7,
      column: 27
    });

    let originalPositionNull = map.originalPositionFor({
      line: 7,
      column: 66
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

    assert.deepEqual(originalPositionNull, {
      source: null,
      name: null,
      line: null,
      column: null
    });

    // Should be able to stringify the map without errors...
    assert.equal(
      await map.stringify({
        file: 'index.min.js',
        rootDir: '/root'
      }),
      '{"version":3,"sources":["a.js","b.js"],"names":["A","B"],"mappings":";;;;;eAA4JA;yBCCjIC,wC","file":"index.min.js"}'
    );
  });
});
