const Path = require('path');
const types = require('babel-types');

const VARS = {
  process: asset => {
    asset.addDependency('process');
    return 'var process = require("process");';
  },
  global: () => 'var global = (1,eval)("this");',
  __dirname: asset =>
    `var __dirname = ${JSON.stringify(Path.dirname(asset.name))};`,
  __filename: asset => `var __filename = ${JSON.stringify(asset.name)};`,
  Buffer: asset => {
    asset.addDependency('buffer');
    return 'var Buffer = require("buffer").Buffer;';
  }
};

module.exports = {
  MemberExpression(node, asset) {
    // Inline environment variables accessed on process.env
    if (matchesPattern(node.object, 'process.env')) {
      let key = types.toComputedKey(node);
      if (types.isStringLiteral(key)) {
        let val = types.valueToNode(process.env[key.value]);
        morph(node, val);
        asset.isAstDirty = true;
      }
    }
  },

  Identifier(node, asset, ancestors) {
    let parent = ancestors[ancestors.length - 2];
    if (
      VARS.hasOwnProperty(node.name) &&
      !asset.globals.has(node.name) &&
      types.isReferenced(node, parent)
    ) {
      asset.globals.set(node.name, VARS[node.name](asset));
    }
  },

  Declaration(node, asset, ancestors) {
    // If there is a global declaration of one of the variables, remove our declaration
    let identifiers = types.getBindingIdentifiers(node);
    for (let id in identifiers) {
      if (VARS.hasOwnProperty(id) && !inScope(ancestors)) {
        // Don't delete entirely, so we don't add it again when the declaration is referenced
        asset.globals.set(id, '');
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

// from babel-types. remove when we upgrade to babel 7.
// https://github.com/babel/babel/blob/0189b387026c35472dccf45d14d58312d249f799/packages/babel-types/src/index.js#L347
function matchesPattern(member, match) {
  // not a member expression
  if (!types.isMemberExpression(member)) {
    return false;
  }

  const parts = Array.isArray(match) ? match : match.split('.');
  const nodes = [];

  let node;
  for (node = member; types.isMemberExpression(node); node = node.object) {
    nodes.push(node.property);
  }

  nodes.push(node);

  if (nodes.length !== parts.length) {
    return false;
  }

  for (let i = 0, j = nodes.length - 1; i < parts.length; i++, j--) {
    const node = nodes[j];
    let value;
    if (types.isIdentifier(node)) {
      value = node.name;
    } else if (types.isStringLiteral(node)) {
      value = node.value;
    } else {
      return false;
    }

    if (parts[i] !== value) {
      return false;
    }
  }

  return true;
}

// replace object properties
function morph(object, newProperties) {
  for (let key in object) {
    delete object[key];
  }

  for (let key in newProperties) {
    object[key] = newProperties[key];
  }
}
