// @flow

import type {
  Asset,
  Bundle,
  BundleGraph,
  PluginOptions,
  Symbol,
} from '@parcel/types';
import type {
  Expression,
  ExpressionStatement,
  ObjectProperty,
  VariableDeclaration,
  Identifier,
  LVal,
  Program,
} from '@babel/types';
import type {NodePath, Scope} from '@babel/traverse';
import type {ExternalModule} from '../types';

import * as t from '@babel/types';
import {
  isIdentifier,
  isObjectExpression,
  isVariableDeclarator,
} from '@babel/types';
import template from '@babel/template';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import {relative} from 'path';
import {relativeBundlePath} from '@parcel/utils';
import ThrowableDiagnostic from '@parcel/diagnostic';
import rename from '../renamer';
import {assertString, getIdentifier} from '../utils';

const REQUIRE_TEMPLATE = template.expression<
  {|
    BUNDLE: Expression,
  |},
  Expression,
>('require(BUNDLE)');
const EXPORT_TEMPLATE = template.statement<
  {|
    NAME: Identifier,
    IDENTIFIER: Expression,
  |},
  ExpressionStatement,
>('exports.NAME = IDENTIFIER;');
const MODULE_EXPORTS_TEMPLATE = template.statement<
  {|
    IDENTIFIER: Expression,
  |},
  ExpressionStatement,
>('module.exports = IDENTIFIER;');
const INTEROP_TEMPLATE = template.expression<
  {|
    MODULE: Expression,
  |},
  Expression,
>('$parcel$interopDefault(MODULE)');
const ASSIGN_TEMPLATE = template.statement<
  {|
    SPECIFIERS: LVal,
    MODULE: Expression,
  |},
  VariableDeclaration,
>('var SPECIFIERS = MODULE;');
const NAMESPACE_TEMPLATE = template.expression<
  {|
    NAMESPACE: Expression,
    MODULE: Expression,
  |},
  Expression,
>('$parcel$exportWildcard(NAMESPACE, MODULE)');

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
  electron: '1.2',
};

function generateDestructuringAssignment(env, specifiers, value, scope) {
  // If destructuring is not supported, generate a series of variable declarations
  // with member expressions for each property.
  if (!env.matchesEngines(DESTRUCTURING_ENGINES)) {
    let statements = [];
    if (!isIdentifier(value) && specifiers.length > 1) {
      let name = scope.generateUid();
      statements.push(
        ASSIGN_TEMPLATE({
          SPECIFIERS: t.identifier(name),
          MODULE: value,
        }),
      );
      value = t.identifier(name);
    }

    for (let specifier of specifiers) {
      invariant(isIdentifier(specifier.value));
      statements.push(
        ASSIGN_TEMPLATE({
          SPECIFIERS: specifier.value,
          MODULE: t.memberExpression(value, specifier.key),
        }),
      );
    }

    return statements;
  }

  return [
    ASSIGN_TEMPLATE({
      SPECIFIERS: t.objectPattern(specifiers),
      MODULE: value,
    }),
  ];
}

export function generateBundleImports(
  from: Bundle,
  bundle: Bundle,
  assets: Set<Asset>,
  scope: Scope,
) {
  let specifiers: Array<ObjectProperty> = [...assets].map(asset => {
    let id = getIdentifier(asset, 'init');
    return t.objectProperty(id, id, false, true);
  });

  let expression = REQUIRE_TEMPLATE({
    BUNDLE: t.stringLiteral(relativeBundlePath(from, bundle)),
  });

  if (specifiers.length > 0) {
    return generateDestructuringAssignment(
      bundle.env,
      specifiers,
      expression,
      scope,
    );
  }

  return [t.expressionStatement(expression)];
}

export function generateExternalImport(
  bundle: Bundle,
  external: ExternalModule,
  scope: Scope,
) {
  let {source, specifiers, isCommonJS} = external;
  let statements = [];
  let properties: Array<ObjectProperty> = [];
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
          symbol === imported,
        ),
      );
    }
  }

  let specifiersWildcard = specifiers.get('*');
  let specifiersDefault = specifiers.get('default');

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
          BUNDLE: t.stringLiteral(source),
        }),
      }),
    );

    if (specifiersWildcard) {
      let value = t.identifier(name);
      if (!isCommonJS) {
        value = NAMESPACE_TEMPLATE({
          NAMESPACE: t.objectExpression([]),
          MODULE: value,
        });
      }

      statements.push(
        ASSIGN_TEMPLATE({
          SPECIFIERS: t.identifier(specifiersWildcard),
          MODULE: value,
        }),
      );
    }

    if (specifiersDefault) {
      statements.push(
        ASSIGN_TEMPLATE({
          SPECIFIERS: t.identifier(specifiersDefault),
          MODULE: INTEROP_TEMPLATE({
            MODULE: t.identifier(name),
          }),
        }),
      );
    }

    if (properties.length > 0) {
      statements.push(
        ...generateDestructuringAssignment(
          bundle.env,
          properties,
          t.identifier(name),
          scope,
        ),
      );
    }
  } else if (specifiersDefault) {
    statements.push(
      ASSIGN_TEMPLATE({
        SPECIFIERS: t.identifier(specifiersDefault),
        MODULE: INTEROP_TEMPLATE({
          MODULE: REQUIRE_TEMPLATE({
            BUNDLE: t.stringLiteral(source),
          }),
        }),
      }),
    );
  } else if (specifiersWildcard) {
    let require = REQUIRE_TEMPLATE({
      BUNDLE: t.stringLiteral(source),
    });

    if (!isCommonJS) {
      require = NAMESPACE_TEMPLATE({
        NAMESPACE: t.objectExpression([]),
        MODULE: require,
      });
    }

    statements.push(
      ASSIGN_TEMPLATE({
        SPECIFIERS: t.identifier(specifiersWildcard),
        MODULE: require,
      }),
    );
  } else if (properties.length > 0) {
    statements.push(
      ...generateDestructuringAssignment(
        bundle.env,
        properties,
        REQUIRE_TEMPLATE({
          BUNDLE: t.stringLiteral(source),
        }),
        scope,
      ),
    );
  } else {
    statements.push(
      t.expressionStatement(
        REQUIRE_TEMPLATE({
          BUNDLE: t.stringLiteral(source),
        }),
      ),
    );
  }

  return statements;
}

export function generateExports(
  bundleGraph: BundleGraph,
  bundle: Bundle,
  referencedAssets: Set<Asset>,
  path: NodePath<Program>,
  replacements: Map<Symbol, Symbol>,
  options: PluginOptions,
) {
  let exported = new Set<Symbol>();
  let statements: Array<ExpressionStatement> = [];

  for (let asset of referencedAssets) {
    let id = getIdentifier(asset, 'init');
    exported.add(id.name);
    statements.push(
      EXPORT_TEMPLATE({
        NAME: id,
        IDENTIFIER: id,
      }),
    );
  }

  let entry = bundle.getMainEntry();
  if (entry) {
    if (entry.meta.isCommonJS) {
      let exportsId = assertString(entry.meta.exportsIdentifier);

      let binding = path.scope.getBinding(exportsId);
      if (binding) {
        // If the exports object is constant, then we can just remove it and rename the
        // references to the builtin CommonJS exports object. Otherwise, assign to module.exports.
        invariant(isVariableDeclarator(binding.path.node));
        let init = binding.path.node.init;
        let isEmptyObject =
          init && isObjectExpression(init) && init.properties.length === 0;
        if (binding.constant && isEmptyObject) {
          for (let path of binding.referencePaths) {
            // This is never a ExportNamedDeclaration
            invariant(isIdentifier(path.node));
            path.node.name = 'exports';
          }

          binding.path.remove();
          exported.add('exports');
        } else {
          exported.add(exportsId);
          statements.push(
            MODULE_EXPORTS_TEMPLATE({
              IDENTIFIER: t.identifier(exportsId),
            }),
          );
        }
      }
    } else {
      for (let {exportSymbol, symbol, asset} of bundleGraph.getExportedSymbols(
        entry,
      )) {
        if (!symbol) {
          let relativePath = relative(options.inputFS.cwd(), asset.filePath);
          throw new ThrowableDiagnostic({
            diagnostic: {
              message: `${relativePath} does not export '${exportSymbol}'`,
              filePath: entry.filePath,
              // TODO: add codeFrames (actual and reexporting asset) when AST from transformers is reused
            },
          });
        }

        let hasReplacement = replacements.get(symbol);
        symbol = hasReplacement ?? symbol;

        // If there is an existing binding with the exported name (e.g. an import),
        // rename it so we can use the name for the export instead.
        if (path.scope.hasBinding(exportSymbol) && exportSymbol !== symbol) {
          rename(
            path.scope,
            exportSymbol,
            path.scope.generateUid(exportSymbol),
          );
        }

        let binding = nullthrows(path.scope.getBinding(symbol));
        if (!hasReplacement) {
          let id = !t.isValidIdentifier(exportSymbol)
            ? path.scope.generateUid(exportSymbol)
            : exportSymbol;
          // rename only once, avoid having to update `replacements` transitively
          rename(path.scope, symbol, id);
          replacements.set(symbol, id);
          symbol = id;
        }

        let [stmt] = binding.path.getStatementParent().insertAfter(
          EXPORT_TEMPLATE({
            NAME: t.identifier(exportSymbol),
            IDENTIFIER: t.identifier(symbol),
          }),
        );
        binding.reference(stmt.get<NodePath<Identifier>>('expression.right'));

        // Exports other than the default export are live bindings. Insert an assignment
        // after each constant violation so this remains true.
        if (exportSymbol !== 'default') {
          for (let path of binding.constantViolations) {
            let [stmt] = path.insertAfter(
              EXPORT_TEMPLATE({
                NAME: t.identifier(exportSymbol),
                IDENTIFIER: t.identifier(symbol),
              }),
            );
            binding.reference(
              stmt.get<NodePath<Identifier>>('expression.right'),
            );
          }
        }
      }
    }
  }

  let stmts = path.pushContainer('body', statements);
  for (let stmt of stmts) {
    let id = stmt.get<NodePath<Identifier>>('expression.right');
    nullthrows(path.scope.getBinding(id.node.name)).reference(id);
  }

  return exported;
}
