import assert from 'assert';

import {escapeMarkdown} from '../src/';

describe('escapeMarkdown', () => {
  it('returns a escaped string 01', () => {
    assert.equal('\\*test\\*', escapeMarkdown('*test*'));
  });

  it('returns a escaped string 02', () => {
    assert.equal('\\_test\\_', escapeMarkdown('_test_'));
  });

  it('returns a escaped string 03', () => {
    assert.equal('\\~test\\~', escapeMarkdown('~test~'));
  });

  it('returns a escaped string 04', () => {
    assert.equal('\\*\\_\\~test\\~\\_\\*', escapeMarkdown('*_~test~_*'));
  });
});
