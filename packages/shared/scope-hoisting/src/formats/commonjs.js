// @flow

import type {Asset, Bundle, Symbol} from '@parcel/types';
import * as t from '@babel/types';
import path from 'path';
import {getIdentifier} from '../utils';
import nullthrows from 'nullthrows';
import rename from '../renamer';
import template from '@babel/template';
import invariant from 'assert';

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
