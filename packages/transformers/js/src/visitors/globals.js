// @flow

import type {MutableAsset} from '@parcel/types';

import nullthrows from 'nullthrows';
import Path from 'path';
import * as types from '@babel/types';
import {hasBinding} from './utils';

const VARS = {
  process: () => ({
    code: 'var process = require("process");',
    deps: ['process']
  }),
  global: () => ({
    code: `var global = arguments[${/*asset.options.scopeHoist ? 0 : */ 3}];`
  }),
  __dirname: asset => ({
    code: `var __dirname = ${JSON.stringify(Path.dirname(asset.filePath))};`
  }),
  __filename: asset => ({
    code: `var __filename = ${JSON.stringify(asset.filePath)};`
  }),
  Buffer: () => ({
    code: 'var Buffer = require("buffer").Buffer;',
    deps: ['buffer']
  }),
  // Prevent AMD defines from working when loading UMD bundles.
  // Ideally the CommonJS check would come before the AMD check, but many
  // existing modules do the checks the opposite way leading to modules
  // not exporting anything to Parcel.
  define: () => ({
    code: 'var define;'
  })
};

export default {
  Identifier(node: any, asset: MutableAsset, ancestors: any) {
    let parent = ancestors[ancestors.length - 2];
    if (
      VARS.hasOwnProperty(node.name) &&
      !nullthrows(asset.meta.globals).has(node.name) &&
      types.isReferenced(node, parent) &&
      !hasBinding(ancestors, node.name)
    ) {
      nullthrows(asset.meta.globals).set(node.name, VARS[node.name](asset));
    }
  },

  Declaration(node: any, asset: MutableAsset, ancestors: any) {
    // If there is a global declaration of one of the variables, remove our declaration
    let identifiers = types.getBindingIdentifiers(node);
    for (let id in identifiers) {
      if (VARS.hasOwnProperty(id) && !inScope(ancestors)) {
        // Don't delete entirely, so we don't add it again when the declaration is referenced
        nullthrows(asset.meta.globals).set(id, null);
      }
    }
  },

  Program: {
    exit(node: any, asset: MutableAsset) {
      // Add dependencies at the end so that items that were deleted later don't leave
      // their dependencies around.
      for (let g of nullthrows(asset.meta.globals).values()) {
        if (g && g.deps) {
          for (let dep of g.deps) {
            asset.addDependency({moduleSpecifier: dep});
          }
        }
      }
    }
  }
};

function inScope(ancestors) {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    if (types.isScope(ancestors[i]) && !types.isProgram(ancestors[i])) {
      return true;
    }
  }

  return false;
}
