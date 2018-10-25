import traverse from 'babel-traverse';
// import nodeBuiltins from 'node-libs-browser';

// Can't use import for these deps
const types = require('babel-types');

export default {
  ImportDeclaration(node, {module, config}) {
    module.meta.isES6Module = true;
    addDependency({module, config}, node.source);
  },

  ExportNamedDeclaration(node, {module, config}) {
    module.meta.isES6Module = true;
    if (node.source) {
      addDependency({module, config}, node.source);
    }
  },

  ExportAllDeclaration(node, {module, config}) {
    module.meta.isES6Module = true;
    addDependency({module, config}, node.source);
  },

  ExportDefaultDeclaration(node, {module /* , config */}) {
    module.meta.isES6Module = true;
  },

  CallExpression(node, {module, config}, ancestors) {
    let {callee, arguments: args} = node;

    let isRequire =
      types.isIdentifier(callee) &&
      callee.name === 'require' &&
      args.length === 1 &&
      types.isStringLiteral(args[0]) &&
      !hasBinding(ancestors, 'require') &&
      !isInFalsyBranch(ancestors);

    if (isRequire) {
      let optional = ancestors.some(a => types.isTryStatement(a)) || undefined;
      addDependency({module, config}, args[0], {optional});
      return;
    }

    let isDynamicImport =
      callee.type === 'Import' &&
      args.length === 1 &&
      types.isStringLiteral(args[0]);

    if (isDynamicImport) {
      addDependency({module, config}, args[0], {dynamic: true});

      // Transform into a normal require. The packager will handle the bundle loading.
      node.callee = types.identifier('require');
      return;
    }
  }
};

function hasBinding(node, name) {
  if (Array.isArray(node)) {
    return node.some(ancestor => hasBinding(ancestor, name));
  } else if (
    types.isProgram(node) ||
    types.isBlockStatement(node) ||
    types.isBlock(node)
  ) {
    return node.body.some(statement => hasBinding(statement, name));
  } else if (
    types.isFunctionDeclaration(node) ||
    types.isFunctionExpression(node) ||
    types.isArrowFunctionExpression(node)
  ) {
    return (
      (node.id !== null && node.id.name === name) ||
      node.params.some(
        param => types.isIdentifier(param) && param.name === name
      )
    );
  } else if (types.isVariableDeclaration(node)) {
    return node.declarations.some(declaration => declaration.id.name === name);
  }

  return false;
}

function isInFalsyBranch(ancestors) {
  // Check if any ancestors are if statements
  return ancestors.some((node, index) => {
    if (types.isIfStatement(node)) {
      let res = evaluateExpression(node.test);
      if (res && res.confident) {
        // If the test is truthy, exclude the dep if it is in the alternate branch.
        // If the test if falsy, exclude the dep if it is in the consequent branch.
        let child = ancestors[index + 1];
        return res.value ? child === node.alternate : child === node.consequent;
      }
    }
  });
}

function evaluateExpression(node) {
  // Wrap the node in a standalone program so we can traverse it
  node = types.file(types.program([types.expressionStatement(node)]));

  // Find the first expression and evaluate it.
  let res = null;
  traverse(node, {
    Expression(path) {
      res = path.evaluate();
      path.stop();
    }
  });

  return res;
}

function addDependency({module /* , config */}, node, opts = {}) {
  // Don't bundle node builtins
  /*if (config.target === 'node' && node.value in nodeBuiltins) {
    return;
  }

  if (!config.bundleNodeModules) {
    const isRelativeImport = /^[/~.]/.test(node.value);
    if (!isRelativeImport) return;
  }*/

  module.dependencies.push({
    moduleSpecifier: node.value,
    loc: node.loc && node.loc.start,
    isAsync: opts.dynamic || false,
    isEntry: opts.entry || false,
    isOptional: opts.optional || false,
    isIncluded: false
  });
}
