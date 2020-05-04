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
 *
 * webpack prefetch
 * ```js
 * import(\/* webpackPrefetch: true *\/`${var}/module`)
 * ```
 */

module.exports = function({template, types: t}) {
  const dummyTemplate = template`
    new Promise(() => {})
  `;
  const syncImportTemplate = template`
    return new Promise((resolve) => {
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
        const {value: importSpecifier, leadingComments} = asyncImport.node;

        if (
          !isString ||
          (leadingComments &&
            leadingComments.length > 0 &&
            leadingComments.some(comment => {
              return comment.value && comment.value.includes('webpackPrefetch');
            }))
        ) {
          // don't rewrite prefetch imports
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
