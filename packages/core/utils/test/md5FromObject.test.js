// @flow
import assert from 'assert';
import {md5FromObject} from '../src/hash';

describe('md5FromObject', () => {
  it('calculates the same hash for two different but deep equal objects', () => {
    const obj1 = {
      foo: {foo: 'foo', baz: ['foo', 'baz', 'bar'], bar: 'bar'},
      baz: 'baz',
      bar: 'bar',
    };
    const obj2 = {
      foo: {foo: 'foo', baz: ['foo', 'baz', 'bar'], bar: 'bar'},
      baz: 'baz',
      bar: 'bar',
    };

    assert.equal(md5FromObject(obj1), md5FromObject(obj2));
  });

  it('calculates a unique hash for two deep equal objects', () => {
    const obj1 = {
      baz: 'baz',
      bar: 'ba',
    };
    const obj2 = {
      baz: 'baz',
      bar: 'bar',
    };

    assert.notEqual(md5FromObject(obj1), md5FromObject(obj2));
  });
});
