// @flow

import type {
  Asset,
  Bundle,
  BundleGraph,
  NamedBundle,
  Symbol,
} from '@parcel/types';
import type {NodePath} from '@babel/traverse';
import type {
  ExpressionStatement,
  Identifier,
  Node,
  Program,
  Statement,
  StringLiteral,
  CallExpression,
} from '@babel/types';
import type {ExternalBundle, ExternalModule} from '../types';

import invariant from 'assert';
import * as t from '@babel/types';
import template from '@babel/template';
import {relativeBundlePath} from '@parcel/utils';
import nullthrows from 'nullthrows';
import {
  assertString,
  getName,
  getThrowableDiagnosticForNode,
  isEntry,
  isReferenced,
} from '../utils';

const IMPORT_TEMPLATE = template.expression<
  {|ASSET_ID: StringLiteral|},
  CallExpression,
>('parcelRequire(ASSET_ID)');
const EXPORT_TEMPLATE = template.statement<
  {|IDENTIFIER: Identifier, ASSET_ID: StringLiteral|},
  ExpressionStatement,
>('parcelRequire.register(ASSET_ID, IDENTIFIER)');
const EXPORT_FN_TEMPLATE = template.statement<
  {|IDENTIFIER: Identifier, ASSET_ID: StringLiteral|},
  ExpressionStatement,
>('parcelRequire.register(ASSET_ID, function() { return IDENTIFIER; })');
const IMPORTSCRIPTS_TEMPLATE = template.statement<
  {|BUNDLE: StringLiteral|},
  Statement,
>('importScripts(BUNDLE);');

export function generateBundleImports(
  from: NamedBundle,
  {bundle, assets}: ExternalBundle,
  path: NodePath<Program>,
) {
  let statements = [];
  if (from.env.isWorker()) {
    statements.push(
      IMPORTSCRIPTS_TEMPLATE({
        BUNDLE: t.stringLiteral(relativeBundlePath(from, bundle)),
      }),
    );
  }
  path.unshiftContainer('body', statements);

  for (let asset of assets) {
    // `var ${id};` was inserted already, add RHS
    nullthrows(path.scope.getBinding(getName(asset, 'init')))
      .path.get('init')
      .replaceWith(IMPORT_TEMPLATE({ASSET_ID: t.stringLiteral(asset.id)}));
  }
}

export function generateExternalImport(_: Bundle, {loc}: ExternalModule) {
  throw getThrowableDiagnosticForNode(
    'External modules are not supported when building for browser',
    loc?.filePath,
    loc,
  );
}

export function generateExports(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: NamedBundle,
  referencedAssets: Set<Asset>,
  path: NodePath<Program>,
) {
  let exported = new Set<Symbol>();
  let statements: Array<ExpressionStatement> = [];

  for (let asset of referencedAssets) {
    let exportsId = getName(asset, 'init');
    exported.add(exportsId);

    statements.push(
      EXPORT_TEMPLATE({
        ASSET_ID: t.stringLiteral(asset.id),
        IDENTIFIER: t.identifier(exportsId),
      }),
    );
  }

  let entry = bundle.getMainEntry();
  if (
    entry &&
    !referencedAssets.has(entry) &&
    (!isEntry(bundle, bundleGraph) || isReferenced(bundle, bundleGraph))
  ) {
    let exportsId = assertString(entry.meta.exportsIdentifier);
    exported.add(exportsId);

    statements.push(
      // Export a function returning the exports, as other cases of global output
      // register init functions.
      EXPORT_FN_TEMPLATE({
        ASSET_ID: t.stringLiteral(entry.id),
        IDENTIFIER: t.identifier(assertString(entry.meta.exportsIdentifier)),
      }),
    );
  }

  let decls = path.pushContainer('body', statements);
  for (let decl of decls) {
    let arg = decl.get<NodePath<Node>>('expression.arguments.1');
    if (!arg.isIdentifier()) {
      // anonymous init function expression
      invariant(arg.isFunctionExpression());
      arg = arg.get<NodePath<Identifier>>('body.body.0.argument');
    }
    // $FlowFixMe
    path.scope.getBinding(arg.node.name)?.reference(arg);
  }

  return exported;
}
