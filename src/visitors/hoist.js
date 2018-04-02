const matchesPattern = require('./matches-pattern');
const t = require('babel-types');

module.exports = {
  Program(path, asset) {
    let scope = path.scope;

    // Re-crawl scope so we are sure to have all bindings.
    scope.crawl();

    // Rename each binding in the top-level scope to something unique.
    for (let name in scope.bindings) {
      let newName = '$' + asset.id + '$var$' + name;
      scope.rename(name, newName);
    }

    // Add variable that represents module.exports
    let name = '$' + asset.id + '$exports';
    path.unshiftContainer('body', [
      t.variableDeclaration('var', [
        t.variableDeclarator(t.identifier(name), t.objectExpression([]))
      ])
    ]);

    asset.isAstDirty = true;
  },

  MemberExpression(path, asset) {
    if (matchesPattern(path.node, 'module.exports')) {
      let name = '$' + asset.id + '$exports';
      path.replaceWith(t.identifier(name));
    }
  },

  ReferencedIdentifier(path, asset) {
    if (path.node.name === 'exports') {
      let name = '$' + asset.id + '$exports';
      path.replaceWith(t.identifier(name));
    }
  },

  CallExpression(path, asset) {
    let {callee, arguments: args} = path.node;

    let isRequire =
      t.isIdentifier(callee) &&
      callee.name === 'require' &&
      args.length === 1 &&
      t.isStringLiteral(args[0]) &&
      !path.scope.hasBinding('require');

    if (isRequire) {
      // Generate a variable name based on the current asset id and the module name to require.
      // This will be replaced by the final variable name of the resolved asset in the packager.
      let name = '$' + asset.id + '$require$' + t.toIdentifier(args[0].value);
      path.replaceWith(t.identifier(name));
    }
  }
};
