'use strict';

const assert = require('assert');
const path = require('path');
const {parse} = require('@babel/eslint-parser');
const readPkgUp = require('read-pkg-up');

const {
  isStaticRequire,
  isStaticResolve,
  relativePathForRequire,
} = require('../src/utils');

const pkgInfo = readPkgUp.sync({cwd: __dirname});
const pkgPath = pkgInfo.path;
const pkgName = pkgInfo.pkg.name;

describe('utils', () => {
  describe('isRequire', () => {
    it('identifies requires', () => {
      assert.equal(
        isStaticRequire(
          getFirstExpression(parse("require('@atlaspack/core')")),
        ),
        true,
      );
    });

    it("doesn't handle dynamic requires", () => {
      assert.equal(
        isStaticRequire(getFirstExpression(parse('require(dynamic)'))),
        false,
      );
    });
  });

  describe('isResolve', () => {
    it('identifies built-in require.resolve', () => {
      assert.equal(
        isStaticResolve(
          getFirstExpression(parse("require.resolve('@atlaspack/core')")),
        ),
        true,
      );
    });
  });

  describe('relativePathForRequire', () => {
    it('behaves identically as path.relative on unix', () => {
      let sep = path.sep;
      path.sep = '/';
      assert.equal(
        relativePathForRequire({
          origin: __filename,
          request: '@atlaspack/eslint-plugin/',
          pkgName,
          pkgPath,
        }),
        '../',
      );
      path.sep = sep;
    });

    it('uses / to separate paths even when path.sep is not /', () => {
      let sep = path.sep;
      path.sep = '\\';
      assert.equal(
        relativePathForRequire({
          origin: __filename,
          request: '@atlaspack/eslint-plugin/',
          pkgName,
          pkgPath,
        }),
        '../',
      );
      path.sep = sep;
    });

    it('leaves absolute paths alone', () => {
      assert.equal(
        relativePathForRequire({
          origin: __filename,
          request: '/a/b',
          pkgName,
          pkgPath,
        }),
        '/a/b',
      );
    });

    it('prepends ./ to peer paths', () => {
      assert.equal(
        relativePathForRequire({
          origin: __filename,
          request: '@atlaspack/eslint-plugin/test/baz',
          pkgName,
          pkgPath,
        }),
        './baz',
      );
    });
  });
});

function getFirstExpression(program) {
  return program.body[0].expression;
}
