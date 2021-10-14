import {parseFuncIRI} from '../src/dependencies';
import assert from 'assert';

describe('parseFuncIRI', () => {
  it('should parse unquoted url()', () => {
    assert.deepEqual(parseFuncIRI('url(test)'), ['test', '']);
    assert.deepEqual(parseFuncIRI('url(test hi)'), null);
    assert.deepEqual(parseFuncIRI('url(test"hi)'), null);
    assert.deepEqual(parseFuncIRI('url(test\\ hi)'), ['test hi', '']);
    assert.deepEqual(parseFuncIRI('url(test\\"hi)'), ['test"hi', '']);
    assert.deepEqual(parseFuncIRI('url(test\nhi)'), null);
    assert.deepEqual(parseFuncIRI('url(test\\\nhi)'), ['test\nhi', '']);
  });

  it('should parse quoted url()', () => {
    assert.deepEqual(parseFuncIRI('url("test")'), ['test', '']);
    assert.deepEqual(parseFuncIRI("url('test')"), ['test', '']);
    assert.deepEqual(parseFuncIRI('url(\'test")'), null);
    assert.deepEqual(parseFuncIRI('url("test\')'), null);
    assert.deepEqual(parseFuncIRI('url("test)'), null);
    assert.deepEqual(parseFuncIRI('url("test" hi)'), ['test', ' hi']);
    assert.deepEqual(parseFuncIRI('url("te\\"st" hi)'), ['te"st', ' hi']);
  });
});
