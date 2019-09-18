// @flow

import type {Asset, Bundle, Symbol} from '@parcel/types';
import * as t from '@babel/types';
import path from 'path';
import {getIdentifier} from '../utils';
import nullthrows from 'nullthrows';
import rename from '../renamer';
import template from '@babel/template';

const IMPORT_TEMPLATE = template('var SPECIFIERS = require(BUNDLE)');
const EXPORT_TEMPLATE = template('exports.IDENTIFIER = IDENTIFIER');
const MODULE_EXPORTS_TEMPLATE = template('module.exports = IDENTIFIER');

export function generateImports(bundle: Bundle, assets: Set<Asset>) {
  let specifiers = [...assets].map(asset => {
    let id = t.identifier(asset.meta.exportsIdentifier);
    return t.objectProperty(id, id, false, true);
  });

  let p = path.relative(bundle.target.distDir, nullthrows(bundle.filePath));
  if (p[0] !== '.') {
    p = './' + p;
  }

  return [
    IMPORT_TEMPLATE({
      SPECIFIERS: t.objectPattern(specifiers),
      BUNDLE: t.stringLiteral(p)
    })
  ];
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
        IDENTIFIER: t.identifier(asset.meta.exportsIdentifier)
      })
    );
  }

  let entry = bundle.getMainEntry();
  if (entry && bundle.isEntry) {
    statements.push(
      MODULE_EXPORTS_TEMPLATE({
        IDENTIFIER: t.identifier(entry.meta.exportsIdentifier)
      })
    );
  }

  path.pushContainer('body', statements);
  return new Set();
}
