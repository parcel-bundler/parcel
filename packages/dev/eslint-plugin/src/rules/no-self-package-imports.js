/*
 * Prevents requiring/importing modules by package name within the same package.
 * e.g. `require('@atlaspack/core/foo')` while in `@atlaspack/core/bar` should be
 *       `require('./foo')`.
 *
 * This can easily happen accidentally while refactoring across the monorepo.
 * Since yarn links all modules in its root `node_modules`, these requires
 * resolve fine in the monorepo, but they'll break in published modules.
 *
 * Supports `require` and `require.resolve` calls as well as `import` declarations.
 *
 * See no-restricted-modules for a similar rule:
 * https://github.com/eslint/eslint/blob/ded2f94758545c7f895f5f848a805b420f41f415/lib/rules/no-restricted-modules.js
 */

'use strict';

const path = require('path');
const readPkgUp = require('read-pkg-up');
const {
  getRequiredPath,
  isStaticRequireOrResolve,
  relativePathForRequire,
} = require('../utils');

const message =
  'Do not require a module by package name within the same package.';

module.exports = {
  meta: {
    description:
      'Forbid importing modules from own package given own package name',
    fixable: 'code',
  },
  create(context) {
    let filename = context.getFilename();
    if (!path.isAbsolute(filename)) {
      // eslint gives the strings '<input>' and '<text>' in tests without
      // explicit filenames and stdin, respectively. Otherwise, it gives an
      // absolute path.
      return;
    }

    let pkgInfo = readPkgUp.sync({cwd: filename});
    let pkgPath = pkgInfo.path;
    let pkgName = pkgInfo.pkg.name;
    if (!pkgName) {
      return;
    }

    return {
      CallExpression(node) {
        if (
          isStaticRequireOrResolve(node) &&
          isSelfImport(pkgName, getRequiredPath(node))
        ) {
          context.report({
            node,
            message,
            fix(fixer) {
              return fixer.replaceText(
                node.arguments[0],
                quote(
                  relativePathForRequire({
                    origin: filename,
                    request: getRequiredPath(node),
                    pkgName,
                    pkgPath,
                  }),
                ),
              );
            },
          });
        }
      },
      ImportDeclaration(node) {
        let request = node.source.value.trim();
        if (isSelfImport(pkgName, request)) {
          context.report({
            node,
            message,
            fix(fixer) {
              return fixer.replaceText(
                node.source,
                quote(
                  relativePathForRequire({
                    origin: filename,
                    request,
                    pkgName,
                    pkgPath,
                  }),
                ),
              );
            },
          });
        }
      },
    };
  },
};

function quote(str) {
  return "'" + str + "'";
}

function isSelfImport(packageName, descriptor) {
  return descriptor === packageName || descriptor.startsWith(packageName + '/');
}
