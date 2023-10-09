// @flow strict-local

import assert from 'assert';
import {BitSet} from '../src/BitSet';

function assertValues(set: BitSet, values: Array<number>) {
  let setValues = [];
  set.forEach(bit => {
    setValues.push(bit);
  });

  for (let value of values) {
    assert(set.has(value), 'Set.has returned false');
    assert(
      setValues.some(v => v === value),
      'Set values is missing value',
    );
  }

  assert(
    setValues.length === values.length,
    `Expected ${values.length} values but got ${setValues.length}`,
  );
}

describe('BitSet', () => {
  it('clone should return a set with the same values', () => {
    let set1 = new BitSet(5);
    set1.add(1);
    set1.add(3);

    let set2 = set1.clone();

    assertValues(set2, [1, 3]);
  });

  it('clear should remove all values from the set', () => {
    let set1 = new BitSet(5);
    set1.add(1);
    set1.add(3);

    set1.clear();

    assertValues(set1, []);
  });

  it('delete should remove values from the set', () => {
    let set1 = new BitSet(5);
    set1.add(1);
    set1.add(3);
    set1.add(5);

    set1.delete(3);

    assertValues(set1, [1, 5]);
  });

  it('empty should check if there are no values set', () => {
    let set1 = new BitSet(5);

    assert(set1.empty());

    set1.add(3);
    assert(!set1.empty());

    set1.delete(3);
    assert(set1.empty());
  });

  it('should intersect with another BitSet', () => {
    let set1 = new BitSet(5);
    set1.add(1);
    set1.add(3);

    let set2 = new BitSet(5);
    set2.add(3);
    set2.add(5);

    set1.intersect(set2);
    assertValues(set1, [3]);
  });

  it('should union with another BitSet', () => {
    let set1 = new BitSet(5);
    set1.add(1);
    set1.add(3);

    let set2 = new BitSet(5);
    set2.add(3);
    set2.add(5);

    set1.union(set2);
    assertValues(set1, [1, 3, 5]);
  });

  it('BitSet.union should create a new BitSet with the union', () => {
    let set1 = new BitSet(5);
    set1.add(1);
    set1.add(3);

    let set2 = new BitSet(5);
    set2.add(3);
    set2.add(5);

    let set3 = BitSet.union(set1, set2);
    assertValues(set1, [1, 3]);
    assertValues(set2, [3, 5]);
    assertValues(set3, [1, 3, 5]);
  });
});
