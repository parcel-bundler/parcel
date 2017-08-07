const template = require('babel-template');
const Path = require('path');
const types = require('babel-types');

const VARS = {
  process: (module) => {
    module.dependencies.add('process');
    return 'var process = require("process");';
  },
  global: () => 'var global = typeof global !== "undefined" ? global : '
            + 'typeof self !== "undefined" ? self : '
            + 'typeof window !== "undefined" ? window : {};',
  __dirname: (module) => `var __dirname = ${JSON.stringify(Path.dirname(module.name))};`,
  __filename: (module) => `var __filename = ${JSON.stringify(module.name)};`,
  Buffer: (module) => {
    module.dependencies.add('buffer');
    return 'var Buffer = require("buffer").Buffer;';
  }
};

module.exports = {
  Identifier(node, module, ancestors) {
    let parent = ancestors[ancestors.length - 2];
    if (VARS.hasOwnProperty(node.name) && !module.globals.has(node.name) && types.isReferenced(node, parent)) {
      module.globals.set(node.name, VARS[node.name](module));
    }
  },

  Declaration(node, module, ancestors) {
    // If there is a global declaration of one of the variables, remove our declaration
    let identifiers = types.getBindingIdentifiers(node);
    for (let id in identifiers) {
      if (VARS.hasOwnProperty(id) && !inScope(ancestors)) {
        // Don't delete entirely, so we don't add it again when the declaration is referenced
        module.globals.set(id, '');
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
