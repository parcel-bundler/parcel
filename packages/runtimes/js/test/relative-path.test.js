// @flow

import assert from 'assert';
import {_dirname as dirname, _relative as relative} from '../src/relative-path';

describe('relative-path', () => {
  describe('dirname', () => {
    it('returns "." for a path without slashes', () => {
      assert.equal(dirname(''), '.');
      assert.equal(dirname('foo'), '.');
    });

    it('returns "." for a path with a single trailing slash', () => {
      assert.equal(dirname('foo/'), '.');
    });

    it('returns the directory for a relative path', () => {
      assert.equal(dirname('foo/bar/baz'), 'foo/bar');
    });

    it('returns the directory for a path with a trailing slash', () => {
      assert.equal(dirname('foo/bar/'), 'foo');
    });

    it('returns the directory for an absolute path', () => {
      assert.equal(dirname('/foo/bar/baz'), '/foo/bar');
    });
  });

  describe('relative', () => {
    it('returns "" when to and from are the same', () => {
      assert.equal(relative('foo/bar/baz', 'foo/bar/baz'), '');
    });

    it('returns a relative upward path when to contains from', () => {
      assert.equal(relative('foo/bar/baz', 'foo/bar'), '..');
      assert.equal(relative('foo/bar/baz', './foo/bar'), '..');
    });

    it('returns a relative upward path when they share a common root', () => {
      assert.equal(relative('foo/bar/baz', 'foo/bar/foobar'), '../foobar');
      assert.equal(
        relative('foo/bar/baz/foobaz', 'foo/bar/foobar'),
        '../../foobar',
      );
    });

    it('returns a relative forward path when from contains to', () => {
      assert.equal(relative('foo/bar', 'foo/bar/baz'), 'baz');
      assert.equal(relative('foo/bar', 'foo/bar/baz/foobar'), 'baz/foobar');
      assert.equal(relative('.', 'foo/bar'), 'foo/bar');
    });
  });
});
