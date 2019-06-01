// @flow

import assert from 'assert';
import {pick, objectSortedEntries} from '../src/collection';

describe('pick', () => {
  it('returns a new object with a subset of key/value pairs', () =>
    assert.deepEqual(
      pick({foo: 'foo', bar: 'baz', baz: 'baz'}, ['foo', 'baz']),
      {
        foo: 'foo',
        baz: 'baz'
      }
    ));
});

describe('objectSortedEntries', () => {
  it('returns a sorted list of key/value tuples', () => {
    assert.deepEqual(
      objectSortedEntries({foo: 'foo', baz: 'baz', bar: 'bar'}),
      [['bar', 'bar'], ['baz', 'baz'], ['foo', 'foo']]
    );
  });
});
