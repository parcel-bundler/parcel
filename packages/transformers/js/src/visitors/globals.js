import Path from 'path';
import * as types from '@babel/types';

const VARS = {
  process: asset => {
    asset.addDependency({moduleSpecifier: 'process'});
    return 'var process = require("process");';
  },
  global: asset =>
    `var global = arguments[${/*asset.options.scopeHoist ? 0 : */ 3}];`,
  __dirname: asset =>
    `var __dirname = ${JSON.stringify(Path.dirname(asset.filePath))};`,
  __filename: asset => `var __filename = ${JSON.stringify(asset.filePath)};`,
  Buffer: asset => {
    asset.addDependency({moduleSpecifier: 'buffer'});
    return 'var Buffer = require("buffer").Buffer;';
  },
  // Prevent AMD defines from working when loading UMD bundles.
  // Ideally the CommonJS check would come before the AMD check, but many
  // existing modules do the checks the opposite way leading to modules
  // not exporting anything to Parcel.
  define: () => 'var define;'
};

export default {
  Identifier(node, asset, ancestors) {
    let parent = ancestors[ancestors.length - 2];
    if (
      VARS.hasOwnProperty(node.name) &&
      !asset.meta.globals.has(node.name) &&
      types.isReferenced(node, parent)
    ) {
      asset.meta.globals.set(node.name, VARS[node.name](asset));
    }
  },

  Declaration(node, asset, ancestors) {
    // If there is a global declaration of one of the variables, remove our declaration
    let identifiers = types.getBindingIdentifiers(node);
    for (let id in identifiers) {
      if (VARS.hasOwnProperty(id) && !inScope(ancestors)) {
        // Don't delete entirely, so we don't add it again when the declaration is referenced
        asset.meta.globals.set(id, '');
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
