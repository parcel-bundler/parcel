// @flow strict-local

import assert from 'assert';
import {BitSet} from '../src/BitSet';

function assertValues<Item>(set: BitSet<Item>, values: Array<Item>) {
  let setValues = set.values();

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
  it('cloneEmpty should return an empty set', () => {
    let set1 = BitSet.from([1, 2, 3, 4, 5]);
    set1.add(1);
    set1.add(3);

    let set2 = set1.cloneEmpty();

    assertValues(set2, []);
  });

  it('clone should return a set with the same values', () => {
    let set1 = BitSet.from([1, 2, 3, 4, 5]);
    set1.add(1);
    set1.add(3);

    let set2 = set1.clone();

    assertValues(set2, [1, 3]);
  });

  it('clear should remove all values from the set', () => {
    let set1 = BitSet.from([1, 2, 3, 4, 5]);
    set1.add(1);
    set1.add(3);

    set1.clear();

    assertValues(set1, []);
  });

  it('delete should remove values from the set', () => {
    let set1 = BitSet.from([1, 2, 3, 4, 5]);
    set1.add(1);
    set1.add(3);
    set1.add(5);

    set1.delete(3);

    assertValues(set1, [1, 5]);
  });

  it('should intersect with another BitSet', () => {
    let set1 = BitSet.from([1, 2, 3, 4, 5]);
    set1.add(1);
    set1.add(3);

    let set2 = set1.cloneEmpty();
    set2.add(3);
    set2.add(5);

    set1.intersect(set2);
    assertValues(set1, [3]);
  });

  it('should union with another BitSet', () => {
    let set1 = BitSet.from([1, 2, 3, 4, 5]);
    set1.add(1);
    set1.add(3);

    let set2 = set1.cloneEmpty();
    set2.add(3);
    set2.add(5);

    set1.union(set2);
    assertValues(set1, [1, 3, 5]);
  });

  it('BitSet.union should create a new BitSet with the union', () => {
    let set1 = BitSet.from([1, 2, 3, 4, 5]);
    set1.add(1);
    set1.add(3);

    let set2 = set1.cloneEmpty();
    set2.add(3);
    set2.add(5);

    let set3 = BitSet.union(set1, set2);
    assertValues(set1, [1, 3]);
    assertValues(set2, [3, 5]);
    assertValues(set3, [1, 3, 5]);
  });

  it('returns an array of all values', () => {
    let set = BitSet.from([1, 2, 3, 4]);
    set.add(1);
    set.add(3);

    assertValues(set, [3, 1]);
  });

  it('should return an error if a new item is added', () => {
    let set = BitSet.from([1, 2, 3, 4]);

    assert.throws(() => set.add(5), /Item is missing from BitSet/);
  });
});
