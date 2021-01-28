// @flow

import type {Asset, BundleGraph, NamedBundle} from '@parcel/types';
import type {
  ExpressionStatement,
  Identifier,
  LVal,
  Statement,
  StringLiteral,
  VariableDeclaration,
  Expression,
} from '@babel/types';
import type {ExternalBundle, ExternalModule} from '../types';
import type {Scope} from '@parcel/babylon-walk';

import * as t from '@babel/types';
import template from '@babel/template';
import {relativeBundlePath} from '@parcel/utils';
import {
  assertString,
  getName,
  getIdentifier,
  getThrowableDiagnosticForNode,
  isEntry,
  isReferenced,
} from '../utils';

const IMPORT_TEMPLATE = template.statement<
  {|NAME: Identifier, ASSET_ID: StringLiteral|},
  ExpressionStatement,
>('var NAME = parcelRequire(ASSET_ID);');
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
const DEFAULT_INTEROP_TEMPLATE = template.statement<
  {|
    NAME: LVal,
    MODULE: Expression,
  |},
  VariableDeclaration,
>('var NAME = $parcel$interopDefault(MODULE);');

export function generateBundleImports(
  bundleGraph: BundleGraph<NamedBundle>,
  from: NamedBundle,
  {bundle, assets}: ExternalBundle,
  scope: Scope,
): Array<BabelNode> {
  let statements = [];
  if (from.env.isWorker()) {
    statements.push(
      IMPORTSCRIPTS_TEMPLATE({
        BUNDLE: t.stringLiteral(relativeBundlePath(from, bundle)),
      }),
    );
  }

  for (let asset of assets) {
    statements.push(
      IMPORT_TEMPLATE({
        NAME: getIdentifier(asset, 'init'),
        ASSET_ID: t.stringLiteral(bundleGraph.getAssetPublicId(asset)),
      }),
    );

    scope.add('$parcel$global');
    scope.add('parcelRequire');

    if (asset.meta.isCommonJS) {
      let deps = bundleGraph.getIncomingDependencies(asset);
      let hasDefaultInterop = deps.some(
        dep =>
          dep.symbols.hasExportSymbol('default') && from.hasDependency(dep),
      );
      if (hasDefaultInterop) {
        statements.push(
          DEFAULT_INTEROP_TEMPLATE({
            NAME: getIdentifier(asset, '$interop$default'),
            MODULE: t.callExpression(getIdentifier(asset, 'init'), []),
          }),
        );

        scope.add('$parcel$interopDefault');
      }
    }
  }
  return statements;
}

export function generateExternalImport(
  // eslint-disable-next-line no-unused-vars
  bundle: NamedBundle,
  {loc}: ExternalModule,
  // eslint-disable-next-line no-unused-vars
  scope: Scope,
): Array<BabelNode> {
  throw getThrowableDiagnosticForNode(
    'External modules are not supported when building for browser',
    loc?.filePath,
    loc,
  );
}

export function generateBundleExports(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: NamedBundle,
  referencedAssets: Set<Asset>,
  scope: Scope,
  // eslint-disable-next-line no-unused-vars
  reexports: Set<{|exportAs: string, local: string|}>,
): Array<BabelNode> {
  let statements: Array<BabelNode> = [];

  for (let asset of referencedAssets) {
    let exportsId = getName(asset, 'init');

    statements.push(
      EXPORT_TEMPLATE({
        ASSET_ID: t.stringLiteral(bundleGraph.getAssetPublicId(asset)),
        IDENTIFIER: t.identifier(exportsId),
      }),
    );

    scope.add('$parcel$global');
    scope.add('parcelRequire');
  }

  let entry = bundle.getMainEntry();
  if (
    entry &&
    !referencedAssets.has(entry) &&
    (!isEntry(bundle, bundleGraph) || isReferenced(bundle, bundleGraph))
  ) {
    statements.push(
      // Export a function returning the exports, as other cases of global output
      // register init functions.
      EXPORT_FN_TEMPLATE({
        ASSET_ID: t.stringLiteral(bundleGraph.getAssetPublicId(entry)),
        IDENTIFIER: t.identifier(assertString(entry.meta.exportsIdentifier)),
      }),
    );

    scope.add('$parcel$global');
    scope.add('parcelRequire');
  }

  return statements;
}

export function generateMainExport(
  node: BabelNode,
  // eslint-disable-next-line no-unused-vars
  exported: Array<{|exportAs: string, local: string|}>,
): Array<BabelNode> {
  return [node];
}
