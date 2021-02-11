// @flow

import type {Asset, BundleGraph, NamedBundle, Symbol} from '@parcel/types';
import type {
  Expression,
  ExpressionStatement,
  Identifier,
  LVal,
  ObjectProperty,
  Statement,
  VariableDeclaration,
} from '@babel/types';
import type {ExternalBundle, ExternalModule} from '../types';
import type {Scope} from '@parcel/babylon-walk';

import * as t from '@babel/types';
import {
  isAssignmentExpression,
  isExpressionStatement,
  isIdentifier,
  isObjectExpression,
  isVariableDeclaration,
} from '@babel/types';
import template from '@babel/template';
import invariant from 'assert';
import {relativeBundlePath} from '@parcel/utils';
import {getIdentifier, getName} from '../utils';

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

function generateDestructuringAssignment(
  env,
  specifiers,
  value,
  scope,
): Array<Statement> {
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
  bundleGraph: BundleGraph<NamedBundle>,
  from: NamedBundle,
  {bundle, assets}: ExternalBundle,
  scope: Scope,
): {|hoisted: Array<Statement>, imports: Array<Statement>|} {
  let specifiers: Array<ObjectProperty> = [...assets].map(asset => {
    let id = getName(asset, 'init');
    return t.objectProperty(t.identifier(id), t.identifier(id), false, true);
  });

  let expression = REQUIRE_TEMPLATE({
    BUNDLE: t.stringLiteral(relativeBundlePath(from, bundle)),
  });

  if (specifiers.length > 0) {
    return {
      imports: generateDestructuringAssignment(
        bundle.env,
        specifiers,
        expression,
        scope,
      ),
      hoisted: [],
    };
  } else {
    return {imports: [t.expressionStatement(expression)], hoisted: []};
  }
}

export function generateExternalImport(
  bundle: NamedBundle,
  external: ExternalModule,
  scope: Scope,
): Array<Statement> {
  let {source, specifiers, isCommonJS} = external;

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

  let statements: Array<Statement> = [];
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

        scope.add('$parcel$exportWildcard');
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

      scope.add('$parcel$interopDefault');
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

    scope.add('$parcel$interopDefault');
  } else if (specifiersWildcard) {
    let require = REQUIRE_TEMPLATE({
      BUNDLE: t.stringLiteral(source),
    });

    if (!isCommonJS) {
      require = NAMESPACE_TEMPLATE({
        NAMESPACE: t.objectExpression([]),
        MODULE: require,
      });

      scope.add('$parcel$exportWildcard');
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

export function generateBundleExports(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: NamedBundle,
  referencedAssets: Set<Asset>,
  scope: Scope,
  reexports: Set<{|exportAs: string, local: string|}>,
): Array<Statement> {
  let exported = new Set<Symbol>();
  let statements: Array<Statement> = [];

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

  for (let exp of reexports) {
    statements.push(
      EXPORT_TEMPLATE({
        NAME: t.identifier(exp.exportAs),
        IDENTIFIER: t.identifier(exp.local),
      }),
    );
  }

  return statements;
}

export function generateMainExport(
  node: BabelNode,
  exported: Array<{|exportAs: string, local: string|}>,
): Array<BabelNode> {
  let statements = [node];

  for (let {exportAs, local} of exported) {
    if (exportAs === '*') {
      // Replace assignments to the `exports` object with `module.exports`
      if (isExpressionStatement(node)) {
        let expression = node.expression;
        invariant(isAssignmentExpression(expression));
        expression.left = t.memberExpression(
          t.identifier('module'),
          t.identifier('exports'),
        );
        continue;
      }

      // Remove the `exports` declaration if set to an empty object.
      // Otherwise, assign to `module.exports`.
      let isExports = false;
      if (isVariableDeclaration(node)) {
        let decl = node.declarations.find(
          decl => isIdentifier(decl.id) && decl.id.name === local,
        );
        isExports =
          decl &&
          decl.init &&
          isObjectExpression(decl.init) &&
          decl.init.properties.length === 0;
      }

      if (!isExports) {
        statements.push(
          MODULE_EXPORTS_TEMPLATE({
            IDENTIFIER: t.identifier(local),
          }),
        );
      } else {
        statements.shift();
      }
    } else {
      // Exports other than the default export are live bindings.
      // Only insert an assignment to module.exports for non-default exports.
      if (isExpressionStatement(node) && exportAs === 'default') {
        continue;
      }

      statements.push(
        EXPORT_TEMPLATE({
          NAME: t.identifier(exportAs),
          IDENTIFIER: t.identifier(local),
        }),
      );
    }
  }

  return statements;
}
