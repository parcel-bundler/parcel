// @flow strict-local

import assert from 'assert';
import stripBOM from '../src/stripBOM';

describe('stripBOM', () => {
  it('should strip UTF-8 BOM from the start of a string', () => {
    const withBOM = '\uFEFF{"name": "test"}';
    const result = stripBOM(withBOM);
    assert.strictEqual(result, '{"name": "test"}');
  });

  it('should not modify strings without BOM', () => {
    const withoutBOM = '{"name": "test"}';
    const result = stripBOM(withoutBOM);
    assert.strictEqual(result, '{"name": "test"}');
  });

  it('should handle empty strings', () => {
    const empty = '';
    const result = stripBOM(empty);
    assert.strictEqual(result, '');
  });

  it('should only strip BOM at the beginning', () => {
    const bomInMiddle = '{"name": "\uFEFFtest"}';
    const result = stripBOM(bomInMiddle);
    assert.strictEqual(result, '{"name": "\uFEFFtest"}');
  });

  it('should allow JSON.parse to work after stripping BOM', () => {
    const withBOM = '\uFEFF{"name": "test", "version": "1.0.0"}';
    const result = JSON.parse(stripBOM(withBOM));
    assert.deepStrictEqual(result, {name: 'test', version: '1.0.0'});
  });
});
