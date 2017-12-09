const template = require('babel-template');
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
  MemberExpression(node, asset, ancestors) {
    // Inline environment variables accessed on process.env
    if (matchesPattern(node.object, 'process.env')) {
      let key = types.toComputedKey(node);
      if (types.isStringLiteral(key)) {
        let val = types.valueToNode(process.env[key.value]);
        replaceIn(ancestors[ancestors.length - 2], node, val);
        delete node.object; // prevent traversing into this node
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

// Replaces first key in `parent` whose value is `from` with `to`
function replaceIn(parent, from, to) {
  if (typeof parent !== 'object') {
    return false;
  }

  if (Array.isArray(parent)) {
    for (let i of parent) {
      if (deepEqual(parent[i], from)) {
        parent[i] = to;
        return true;
      }
      if (replaceIn(parent[i], from, to)) {
        return true;
      }
    }
  }

  for (let key in parent) {
    if (deepEqual(parent[key], from)) {
      parent[key] = to;
      return true;
    }
    if (replaceIn(parent[key], from, to)) {
      return true;
    }
  }

  return false;
}

function deepEqual(a, b) {
  if (!!a !== !!b) {
    return false;
  }

  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  if (typeof a !== 'object') {
    return a === b;
  }

  if (Array.isArray(a)) {
    return a.every((_, i) => deepEqual(a[i], b[i]));
  }

  for (let key in a) {
    if (!deepEqual(a[key], b[key])) {
      return false;
    }
  }
  return true;
}
