// @flow

import type {Asset, Bundle, Symbol} from '@parcel/types';
import * as t from '@babel/types';
import {urlJoin} from '@parcel/utils';
import {getIdentifier} from '../utils';
import nullthrows from 'nullthrows';
import rename from '../renamer';
import template from '@babel/template';

const IMPORT_TEMPLATE = template('var IDENTIFIER = parcelRequire(ASSET_ID)');
const EXPORT_TEMPLATE = template(
  'parcelRequire.register(ASSET_ID, IDENTIFIER)'
);

export function generateImports(bundle: Bundle, assets: Set<Asset>) {
  let statements = [];
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

export function generateExports(
  bundle: Bundle,
  referencedAssets: Set<Asset>,
  path: any
) {
  let statements = [];
  for (let asset of referencedAssets) {
    statements.push(
      EXPORT_TEMPLATE({
        ASSET_ID: t.stringLiteral(asset.id),
        IDENTIFIER: t.identifier(asset.meta.exportsIdentifier)
      })
    );
  }

  path.pushContainer('body', statements);
  return new Set();
}
