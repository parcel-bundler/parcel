// @flow

import type {
  Asset,
  Bundle,
  BundleGraph,
  Symbol,
  ModuleSpecifier
} from '@parcel/types';
import * as t from '@babel/types';
import template from '@babel/template';
import invariant from 'assert';
import {relativeBundlePath} from '@parcel/utils';

const REQUIRE_TEMPLATE = template('require(BUNDLE)');
const EXPORT_TEMPLATE = template('exports.IDENTIFIER = IDENTIFIER');
const MODULE_EXPORTS_TEMPLATE = template('module.exports = IDENTIFIER');
const INTEROP_TEMPLATE = template('$parcel$interopDefault(MODULE)');
const ASSIGN_TEMPLATE = template('var SPECIFIERS = MODULE');
const NAMESPACE_TEMPLATE = template(
  '$parcel$exportWildcard(NAMESPACE, MODULE)'
);

export function generateBundleImports(
  from: Bundle,
  bundle: Bundle,
  assets: Set<Asset>
) {
  let specifiers = [...assets].map(asset => {
    let id = t.identifier(asset.meta.exportsIdentifier);
    return t.objectProperty(id, id, false, true);
  });

  let statement = REQUIRE_TEMPLATE({
    BUNDLE: t.stringLiteral(relativeBundlePath(from, bundle))
  });

  if (specifiers.length > 0) {
    statement = ASSIGN_TEMPLATE({
      SPECIFIERS: t.objectPattern(specifiers),
      MODULE: statement.expression
    });
  }

  return [statement];
}

export function generateExternalImport(
  source: ModuleSpecifier,
  specifiers: Map<Symbol, Symbol>,
  scope: any
) {
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
      statements.push(
        ASSIGN_TEMPLATE({
          SPECIFIERS: t.identifier(specifiers.get('*')),
          MODULE: NAMESPACE_TEMPLATE({
            NAMESPACE: t.objectExpression([]),
            MODULE: name
          }).expression
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
        ASSIGN_TEMPLATE({
          SPECIFIERS: t.objectPattern(properties),
          MODULE: t.identifier(name)
        })
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
    statements.push(
      ASSIGN_TEMPLATE({
        SPECIFIERS: t.identifier(specifiers.get('default')),
        MODULE: NAMESPACE_TEMPLATE({
          NAMESPACE: t.objectExpression([]),
          MODULE: REQUIRE_TEMPLATE({
            BUNDLE: t.stringLiteral(source)
          }).expression
        }).expression
      })
    );
  } else if (properties.length > 0) {
    statements.push(
      ASSIGN_TEMPLATE({
        SPECIFIERS: t.objectPattern(properties),
        MODULE: REQUIRE_TEMPLATE({
          BUNDLE: t.stringLiteral(source)
        }).expression
      })
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
  path: any
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
  if (entry && bundle.isEntry) {
    let exportsId = entry.meta.exportsIdentifier;
    invariant(typeof exportsId === 'string');

    let binding = path.scope.getBinding(exportsId);
    if (binding) {
      // If the exports object is constant, then we can just remove it and rename the
      // references to the builtin CommonJS exports object. Otherwise, assign to module.exports.
      if (binding.constant) {
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
  }

  path.pushContainer('body', statements);
  return exported;
}
