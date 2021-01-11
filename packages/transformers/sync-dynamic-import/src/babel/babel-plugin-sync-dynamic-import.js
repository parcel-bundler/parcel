/**
 * Custom Babel Plugin - replace import('xxx') to a promise that returns the `require('xxx')`
 *
 * What is supported:
 *   static import
 *
 * Example:
 *
 * From
 *
 * ```js
 * const mod = import('module')
 * ```
 * To
 *
 * ```js
 * const mod = new Promise(res => resolve(require('module')))
 * ```
 *
 * What is not supported:
 *
 * ```js
 * const mod = import(`${var}/module`)
 * ```
 */

module.exports = function({template, types: t}) {
  const dummyTemplate = template`
    new Promise(() => {})
  `;
  const syncImportTemplate = template`
    new Promise((resolve, reject) => {
      try {
        const resolved = require(MODULE);
        resolve(resolved)
      } catch(e) {
        reject(e)
      }
    })
  `;
  return {
    visitor: {
      Import(path) {
        const callExpression = path.parentPath;
        const args = callExpression.get('arguments');
        const asyncImport = args[0];
        const isString = t.isStringLiteral(asyncImport);
        const {value: importSpecifier} = asyncImport.node;

        if (!isString) {
          // don't rewrite imports that aren't strings
          asyncImport.parentPath.replaceWithMultiple(dummyTemplate());
          return;
        }

        asyncImport.parentPath.replaceWithMultiple(
          syncImportTemplate({MODULE: t.stringLiteral(importSpecifier)}),
        );
      },
    },
  };
};
