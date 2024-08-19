'use strict';

const path = require('path');

function isStaticRequireOrResolve(node) {
  return isStaticRequire(node) || isStaticResolve(node);
}

/*
 * Detects whether a node is a call expression matching `require('foo')`,
 * `require.resolve('foo')`, etc.
 *
 * `isStaticRequire` and `isStaticResolve` each combine checks from the following
 *   examples, aiming for strictness without redundant checks:
 * https://github.com/parcel-bundler/parcel/blob/7a540fc4cc2511f749f3a687ce342000953cfcec/packages/core/parcel-bundler/src/visitors/dependencies.js#L37
 * https://github.com/benmosher/eslint-plugin-import/blob/3b04d5fab6c095e7f0f99488665d90e285872271/src/core/staticRequire.js#L2
 * https://github.com/facebookarchive/nuclide/blob/2a2a0a642d136768b7d2a6d35a652dc5fb77d70a/modules/eslint-plugin-nuclide-internal/utils.js#L46
 * https://github.com/eslint/eslint/blob/ded2f94758545c7f895f5f848a805b420f41f415/lib/rules/no-restricted-modules.js#L118
 */
function isStaticRequire(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Literal' // don't analyze dynamic requires
  );
}

function isStaticResolve(node) {
  if (node.type !== 'CallExpression') {
    return false;
  }

  let callee = node.callee;
  return (
    callee.type === 'MemberExpression' &&
    callee.object.name === 'require' &&
    callee.property.name === 'resolve' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Literal'
  );
}

function getRequiredPath(node) {
  return (
    node.arguments &&
    node.arguments[0] &&
    typeof node.arguments[0].value === 'string' &&
    node.arguments[0].value.trim()
  );
}

/**
 * Like path.relative, but for determining relative path between a filepath and
 * a module it requests in a `require`.
 * @param {Object} opts
 * @param {string} opts.origin - Originating file. Must be an absolute path.
 * @param {string} opts.request - Requested module in the require. e.g. @atlaspack/core
 * @param {string} opts.pkgName - name of the package in the package json
 * @param {string} opts.pkgPath - path to the package.json
 */
function relativePathForRequire({origin, request, pkgName, pkgPath}) {
  if (!path.isAbsolute(origin)) {
    throw new TypeError('`origin` must be an absolute path');
  }

  if (path.isAbsolute(request)) {
    return request;
  }

  const pkgRoot = path.dirname(pkgPath);
  let relative = path
    .relative(
      path.dirname(origin),
      request.replace(new RegExp('^' + pkgName), pkgRoot),
    )
    // `require` expects unix-style '/' separators, but `path.relative` will respect
    // `path.sep`.
    .split(path.sep)
    .join('/');

  // prefer `require('../')` over `require('..')`
  // match '..', '../..', but not 'foo..'
  if (relative.match(/(?:^|\/)\.\.$/)) {
    relative += '/';
  }

  if (!relative.startsWith('.')) {
    // peer files must lead with ./
    relative = './' + relative;
  }

  return relative;
}

module.exports = {
  getRequiredPath,
  isStaticRequire,
  isStaticRequireOrResolve,
  isStaticResolve,
  relativePathForRequire,
};
