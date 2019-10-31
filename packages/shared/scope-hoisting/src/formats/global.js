// @flow

import type {Asset, Bundle, BundleGraph, Symbol} from '@parcel/types';
import * as t from '@babel/types';
import template from '@babel/template';
import invariant from 'assert';
import {relativeBundlePath} from '@parcel/utils';
import {isEntry, isReferenced} from '../utils';

const IMPORT_TEMPLATE = template('var IDENTIFIER = parcelRequire(ASSET_ID)');
const EXPORT_TEMPLATE = template(
  'parcelRequire.register(ASSET_ID, IDENTIFIER)'
);
const IMPORTSCRIPTS_TEMPLATE = template('importScripts(BUNDLE)');

export function generateBundleImports(
  from: Bundle,
  bundle: Bundle,
  assets: Set<Asset>
) {
  let statements = [];

  if (from.env.isWorker()) {
    statements.push(
      IMPORTSCRIPTS_TEMPLATE({
        BUNDLE: t.stringLiteral(relativeBundlePath(from, bundle))
      })
    );
  }

  for (let asset of assets) {
    statements.push(
      IMPORT_TEMPLATE({
        IDENTIFIER: t.identifier(asset.meta.exportsIdentifier),
        ASSET_ID: t.stringLiteral(asset.id)
      })
    );
  }

  return statements;
}

export function generateExternalImport() {
  throw new Error(
    'External modules are not supported when building for browser'
  );
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
        ASSET_ID: t.stringLiteral(asset.id),
        IDENTIFIER: t.identifier(asset.meta.exportsIdentifier)
      })
    );
  }

  let entry = bundle.getMainEntry();
  if (
    entry &&
    (!isEntry(bundle, bundleGraph) || isReferenced(bundle, bundleGraph))
  ) {
    let exportsId = entry.meta.exportsIdentifier;
    invariant(typeof exportsId === 'string');
    exported.add(exportsId);

    statements.push(
      EXPORT_TEMPLATE({
        ASSET_ID: t.stringLiteral(entry.id),
        IDENTIFIER: t.identifier(entry.meta.exportsIdentifier)
      })
    );
  }

  path.pushContainer('body', statements);
  return exported;
}
