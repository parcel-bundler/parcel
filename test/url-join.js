const assert = require('assert');
const urlJoin = require('../src/utils/urlJoin');

describe('Url Join', () => {
  it('should join a filename with a URL', () => {
    assert.equal(
      urlJoin('https://parceljs.org', 'a.js'),
      'https://parceljs.org/a.js'
    );
  });

  it('should join a path with a URL', () => {
    assert.equal(
      urlJoin('https://parceljs.org', 'bar/a.js'),
      'https://parceljs.org/bar/a.js'
    );
  });

  it('should join a paths together', () => {
    assert.equal(
      urlJoin('https://parceljs.org/foo/', 'bar/a.js'),
      'https://parceljs.org/foo/bar/a.js'
    );
  });

  it('should join an absolute path with a URL', () => {
    assert.equal(
      urlJoin('https://parceljs.org/foo/', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js'
    );
  });

  it('should join a URL with a querystring', () => {
    assert.equal(
      urlJoin('https://parceljs.org/foo?a=123', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js?a=123'
    );

    assert.equal(
      urlJoin('https://parceljs.org/foo?a=123&b=456', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js?a=123&b=456'
    );
  });

  it('should join a URL with a hash', () => {
    assert.equal(
      urlJoin('https://parceljs.org/foo#hello', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js#hello'
    );

    assert.equal(
      urlJoin('https://parceljs.org/foo?a=123&b=456#hello', '/bar/a.js'),
      'https://parceljs.org/foo/bar/a.js?a=123&b=456#hello'
    );
  });

  it('should join two paths together', () => {
    assert.equal(
      urlJoin('/Users/people/projects/parcel', '/bar/foo.js'),
      '/Users/people/projects/parcel/bar/foo.js'
    );
  });

  it('should support windows paths', () => {
    assert.equal(urlJoin('dist\\foo', '\\bar\\foo.js'), 'dist/foo/bar/foo.js');
  });
});
