// @flow

import type {MutableAsset} from '@parcel/types';

import Path from 'path';
import * as types from '@babel/types';
import {isInFalsyBranch, hasBinding} from './utils';

export type GlobalsMap = Map<
  string,
  ?{code: string, deps?: Array<string>, ...},
>;

type TraverseContext = {|
  asset: MutableAsset,
  globals: GlobalsMap,
|};

const VARS = {
  process: () => ({
    code: 'var process = require("process");',
    deps: ['process'],
  }),
  global: asset =>
    asset.env.shouldScopeHoist
      ? /* Scope hoisting replaces this on its own in hoist.js */ null
      : /* the global `this` is passed as an argument in position 3 in standard JSPackager */ {
          code: `var global = arguments[3];`,
        },
  __dirname: asset => ({
    code: `var __dirname = ${JSON.stringify(Path.dirname(asset.filePath))};`,
  }),
  __filename: asset => ({
    code: `var __filename = ${JSON.stringify(asset.filePath)};`,
  }),
  Buffer: () => ({
    code: 'var Buffer = require("buffer").Buffer;',
    deps: ['buffer'],
  }),
  // Prevent AMD defines from working when loading UMD bundles.
  // Ideally the CommonJS check would come before the AMD check, but many
  // existing modules do the checks the opposite way leading to modules
  // not exporting anything to Parcel.
  define: () => ({
    code: 'var define;',
  }),
};

export default {
  Identifier(node: any, context: TraverseContext, ancestors: any) {
    let parent = ancestors[ancestors.length - 2];
    if (
      VARS.hasOwnProperty(node.name) &&
      !context.globals.has(node.name) &&
      types.isReferenced(node, parent) &&
      !types.isModuleSpecifier(parent) &&
      !hasBinding(ancestors, node.name) &&
      !isInFalsyBranch(ancestors)
    ) {
      context.globals.set(node.name, VARS[node.name](context.asset));
    }
  },

  Declaration(node: any, context: TraverseContext, ancestors: any) {
    // If there is a global declaration of one of the variables, remove our declaration
    let identifiers = types.getBindingIdentifiers(node);
    for (let id in identifiers) {
      if (VARS.hasOwnProperty(id) && !inScope(ancestors)) {
        // Don't delete entirely, so we don't add it again when the declaration is referenced
        context.globals.set(id, null);
      }
    }
  },

  Program: {
    exit(node: any, context: TraverseContext) {
      // Add dependencies at the end so that items that were deleted later don't leave
      // their dependencies around.
      for (let g of context.globals.values()) {
        if (g && g.deps) {
          for (let dep of g.deps) {
            context.asset.addDependency({moduleSpecifier: dep});
          }
        }
      }
    },
  },
};

function inScope(ancestors) {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    if (types.isScope(ancestors[i]) && !types.isProgram(ancestors[i])) {
      return true;
    }
  }

  return false;
}
