const assert = require('assert');
const urlJoin = require('../src/utils/urlJoin');

describe('Url Join', () => {
  it('should return url', () => {
    assert.equal(
      urlJoin('https://parceljs.org', 'a.js'),
      'https://parceljs.org/a.js'
    );

    assert.equal(
      urlJoin('https://parceljs.org', 'bar/a.js'),
      'https://parceljs.org/bar/a.js'
    );

    assert.equal(
      urlJoin('https://parceljs.org/foo/', 'bar/a.js'),
      'https://parceljs.org/foo/bar/a.js'
    );

    assert.equal(
      urlJoin('https://parceljs.org/foo/', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js'
    );

    assert.equal(
      urlJoin('https://parceljs.org/foo?a=123', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js?a=123'
    );

    assert.equal(
      urlJoin('https://parceljs.org/foo?a=123&b=456', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js?a=123&b=456'
    );

    assert.equal(
      urlJoin('https://parceljs.org/foo#hello', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js#hello'
    );

    assert.equal(
      urlJoin('https://parceljs.org/foo?a=123&b=456#hello', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js?a=123&b=456#hello'
    );

    assert.equal(
      urlJoin('/Users/people/projects/parcel', '/bar/foo.js'),
      '/Users/people/projects/parcel/bar/foo.js'
    );
  });
});
