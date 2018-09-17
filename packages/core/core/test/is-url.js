const assert = require('assert');
const isURL = require('../src/utils/is-url');

describe('isURL', () => {
  it('should match url', () => {
    assert(isURL('https://parceljs.org/'));
  });

  it('should match anchor', () => {
    assert(isURL('#'));
    assert(isURL('#foo'));
  });

  it('should match scheme-only', () => {
    assert(isURL('tel:'));
    assert(isURL('https:'));
    assert(isURL('mailto:'));
    assert(isURL('itms-apps:'));
  });
});
