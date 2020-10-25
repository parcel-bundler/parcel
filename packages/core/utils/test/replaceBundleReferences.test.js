import assert from 'assert';

import {regexReplaceWithLocations} from '../src/replaceBundleReferences';

describe('regexReplaceWithLocations', () => {
  it('Replace references and return offsets', () => {
    let result = regexReplaceWithLocations(
      'let HASH_12345 = 1253; let HASH_6543254 = 76;\nlet something = "test";',
      new Map([
        ['HASH_12345', 'valueOne'],
        ['HASH_6543254', 'valueTwo'],
      ]),
    );

    assert.equal(
      result.result,
      'let valueOne = 1253; let valueTwo = 76;\nlet something = "test";',
    );

    assert.deepEqual(result.offsets, [
      {
        line: 1,
        column: 4,
        offset: -2,
      },
      {
        line: 1,
        column: 25,
        offset: -4,
      },
    ]);
  });

  it('Replace references and return offsets across multiple lines', () => {
    let result = regexReplaceWithLocations(
      'let HASH_12345 = 1253; let HASH_6543254 = 76;\nlet HASH_65 = "test";',
      new Map([
        ['HASH_65', 'valueThree'],
        ['HASH_12345', 'valueOne'],
        ['HASH_6543254', 'valueTwo'],
      ]),
    );

    assert.equal(
      result.result,
      'let valueOne = 1253; let valueTwo = 76;\nlet valueThree = "test";',
    );

    assert.deepEqual(result.offsets, [
      {
        line: 1,
        column: 4,
        offset: -2,
      },
      {
        line: 1,
        column: 25,
        offset: -4,
      },
      {
        line: 2,
        column: 4,
        offset: 3,
      },
    ]);
  });
});
