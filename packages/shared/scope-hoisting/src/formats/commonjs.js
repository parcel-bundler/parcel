// @flow

import type {Asset, Bundle, BundleGraph, Symbol} from '@parcel/types';
import type {ExternalModule} from '../types';
import * as t from '@babel/types';
import template from '@babel/template';
import invariant from 'assert';
import {relativeBundlePath} from '@parcel/utils';
import rename from '../renamer';

const REQUIRE_TEMPLATE = template('require(BUNDLE)');
const EXPORT_TEMPLATE = template('exports.IDENTIFIER = IDENTIFIER');
const MODULE_EXPORTS_TEMPLATE = template('module.exports = IDENTIFIER');
const INTEROP_TEMPLATE = template('$parcel$interopDefault(MODULE)');
const ASSIGN_TEMPLATE = template('var SPECIFIERS = MODULE');
const NAMESPACE_TEMPLATE = template(
  '$parcel$exportWildcard(NAMESPACE, MODULE)'
);

// List of engines that support object destructuring syntax
const DESTRUCTURING_ENGINES = {
  chrome: '51',
  edge: '15',
  firefox: '53',
  safari: '10',
  node: '6.5',
  ios: '10',
  samsung: '5',
  opera: '38',
  electron: '1.2'
};

function generateDestructuringAssignment(env, specifiers, value, scope) {
  // If destructuring is not supported, generate a series of variable declarations
  // with member expressions for each property.
  if (!env.matchesEngines(DESTRUCTURING_ENGINES)) {
    let statements = [];
    if (!t.isIdentifier(value) && specifiers.length > 1) {
      let name = scope.generateUid();
      statements.push(
        ASSIGN_TEMPLATE({
          SPECIFIERS: t.identifier(name),
          MODULE: value
        })
      );
      value = t.identifier(name);
    }

    for (let specifier of specifiers) {
      statements.push(
        ASSIGN_TEMPLATE({
          SPECIFIERS: specifier.value,
          MODULE: t.memberExpression(value, specifier.key)
        })
      );
    }

    return statements;
  }

  return [
    ASSIGN_TEMPLATE({
      SPECIFIERS: t.objectPattern(specifiers),
      MODULE: value
    })
  ];
}

export function generateBundleImports(
  from: Bundle,
  bundle: Bundle,
  assets: Set<Asset>,
  scope: any
) {
  let specifiers = [...assets].map(asset => {
    let id = t.identifier(asset.meta.exportsIdentifier);
    return t.objectProperty(id, id, false, true);
  });

  let statement = REQUIRE_TEMPLATE({
    BUNDLE: t.stringLiteral(relativeBundlePath(from, bundle))
  });

  if (specifiers.length > 0) {
    return generateDestructuringAssignment(
      bundle.env,
      specifiers,
      statement.expression,
      scope
    );
  }

  return [statement];
}

export function generateExternalImport(
  bundle: Bundle,
  external: ExternalModule,
  scope: any
) {
  let {source, specifiers, isCommonJS} = external;
  let statements = [];
  let properties = [];
  let categories = new Set();
  for (let [imported, symbol] of specifiers) {
    if (imported === '*') {
      categories.add('namespace');
    } else if (imported === 'default') {
      categories.add('default');
    } else {
      categories.add('named');
      properties.push(
        t.objectProperty(
          t.identifier(imported),
          t.identifier(symbol),
          false,
          symbol === imported
        )
      );
    }
  }

  // Attempt to combine require calls as much as possible. Namespace, default, and named specifiers
  // cannot be combined, so in the case where we have more than one type, assign the require() result
  // to a variable first and then create additional variables for each specifier based on that.
  // Otherwise, if just one category is imported, just assign and require all at once.
  if (categories.size > 1) {
    let name = scope.generateUid(source);
    statements.push(
      ASSIGN_TEMPLATE({
        SPECIFIERS: t.identifier(name),
        MODULE: REQUIRE_TEMPLATE({
          BUNDLE: t.stringLiteral(source)
        }).expression
      })
    );

    if (specifiers.has('*')) {
      let value = name;
      if (!isCommonJS) {
        value = NAMESPACE_TEMPLATE({
          NAMESPACE: t.objectExpression([]),
          MODULE: value
        }).expression;
      }

      statements.push(
        ASSIGN_TEMPLATE({
          SPECIFIERS: t.identifier(specifiers.get('*')),
          MODULE: value
        })
      );
    }

    if (specifiers.has('default')) {
      statements.push(
        ASSIGN_TEMPLATE({
          SPECIFIERS: t.identifier(specifiers.get('default')),
          MODULE: INTEROP_TEMPLATE({
            MODULE: t.identifier(name)
          }).expression
        })
      );
    }

    if (properties.length > 0) {
      statements.push(
        ...generateDestructuringAssignment(
          bundle.env,
          properties,
          t.identifier(name),
          scope
        )
      );
    }
  } else if (specifiers.has('default')) {
    statements.push(
      ASSIGN_TEMPLATE({
        SPECIFIERS: t.identifier(specifiers.get('default')),
        MODULE: INTEROP_TEMPLATE({
          MODULE: REQUIRE_TEMPLATE({
            BUNDLE: t.stringLiteral(source)
          }).expression
        }).expression
      })
    );
  } else if (specifiers.has('*')) {
    let require = REQUIRE_TEMPLATE({
      BUNDLE: t.stringLiteral(source)
    }).expression;

    if (!isCommonJS) {
      require = NAMESPACE_TEMPLATE({
        NAMESPACE: t.objectExpression([]),
        MODULE: require
      }).expression;
    }

    statements.push(
      ASSIGN_TEMPLATE({
        SPECIFIERS: t.identifier(specifiers.get('*')),
        MODULE: require
      })
    );
  } else if (properties.length > 0) {
    statements.push(
      ...generateDestructuringAssignment(
        bundle.env,
        properties,
        REQUIRE_TEMPLATE({
          BUNDLE: t.stringLiteral(source)
        }).expression,
        scope
      )
    );
  } else {
    statements.push(
      REQUIRE_TEMPLATE({
        BUNDLE: t.stringLiteral(source)
      })
    );
  }

  return statements;
}

export function generateExports(
  bundleGraph: BundleGraph,
  bundle: Bundle,
  referencedAssets: Set<Asset>,
  path: any,
  replacements: Map<Symbol, Symbol>
) {
  let exported = new Set<Symbol>();
  let statements = [];

  for (let asset of referencedAssets) {
    let exportsId = asset.meta.exportsIdentifier;
    invariant(typeof exportsId === 'string');
    exported.add(exportsId);

    statements.push(
      EXPORT_TEMPLATE({
        IDENTIFIER: t.identifier(exportsId)
      })
    );
  }

  let entry = bundle.getMainEntry();
  if (entry) {
    if (entry.meta.isCommonJS) {
      let exportsId = entry.meta.exportsIdentifier;
      invariant(typeof exportsId === 'string');

      let binding = path.scope.getBinding(exportsId);
      if (binding) {
        // If the exports object is constant, then we can just remove it and rename the
        // references to the builtin CommonJS exports object. Otherwise, assign to module.exports.
        let init = binding.path.node.init;
        let isEmptyObject =
          init && t.isObjectExpression(init) && init.properties.length === 0;
        if (binding.constant && isEmptyObject) {
          for (let path of binding.referencePaths) {
            path.node.name = 'exports';
          }

          binding.path.remove();
          exported.add('exports');
        } else {
          exported.add(exportsId);
          statements.push(
            MODULE_EXPORTS_TEMPLATE({
              IDENTIFIER: t.identifier(exportsId)
            })
          );
        }
      }
    } else {
      for (let {exportSymbol, symbol} of bundleGraph.getExportedSymbols(
        entry
      )) {
        if (symbol) {
          symbol = replacements.get(symbol) || symbol;
        }

        // If there is an existing binding with the exported name (e.g. an import),
        // rename it so we can use the name for the export instead.
        if (path.scope.hasBinding(exportSymbol) && exportSymbol !== symbol) {
          rename(
            path.scope,
            exportSymbol,
            path.scope.generateUid(exportSymbol)
          );
        }

        let binding = path.scope.getBinding(symbol);
        rename(path.scope, symbol, exportSymbol);

        binding.path.getStatementParent().insertAfter(
          EXPORT_TEMPLATE({
            IDENTIFIER: t.identifier(exportSymbol)
          })
        );

        // Exports other than the default export are live bindings. Insert an assignment
        // after each constant violation so this remains true.
        if (exportSymbol !== 'default') {
          for (let path of binding.constantViolations) {
            path.insertAfter(
              EXPORT_TEMPLATE({
                IDENTIFIER: t.identifier(exportSymbol)
              })
            );
          }
        }
      }
    }
  }

  path.pushContainer('body', statements);
  return exported;
}
