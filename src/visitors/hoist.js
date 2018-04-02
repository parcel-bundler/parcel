const matchesPattern = require('./matches-pattern');
const t = require('babel-types');
const template = require('babel-template');

const WRAPPER_TEMPLATE = template(`
  var NAME = (function () {
    var exports = this;
    var module = {exports: this};
    BODY;
    return module.exports;
  }).call({});
`);

const EXPORTS_TEMPLATE = template('var NAME = {}');

module.exports = {
  Program: {
    enter(path) {
      let hasEval = false;
      path.traverse({
        CallExpression(path) {
          let callee = path.node.callee;
          if (
            t.isIdentifier(callee) &&
            callee.name === 'eval' &&
            !path.scope.hasBinding('eval', true)
          ) {
            hasEval = true;
            path.stop();
          }
        }
      });

      path.scope.setData('hasEval', hasEval);
    },

    exit(path, asset) {
      let scope = path.scope;

      if (scope.getData('hasEval')) {
        path.replaceWith(
          t.program([
            WRAPPER_TEMPLATE({
              NAME: getExportsIdentifier(asset),
              BODY: path.node.body
            })
          ])
        );
      } else {
        // Re-crawl scope so we are sure to have all bindings.
        scope.crawl();

        // Rename each binding in the top-level scope to something unique.
        for (let name in scope.bindings) {
          let newName = '$' + asset.id + '$var$' + name;
          scope.rename(name, newName);
        }

        // Add variable that represents module.exports
        path.unshiftContainer('body', [
          EXPORTS_TEMPLATE({
            NAME: getExportsIdentifier(asset)
          })
        ]);
      }

      path.stop();
      asset.isAstDirty = true;
    }
  },

  MemberExpression(path, asset) {
    if (
      matchesPattern(path.node, 'module.exports') &&
      !path.scope.hasBinding('module') &&
      !path.scope.getData('hasEval')
    ) {
      path.replaceWith(getExportsIdentifier(asset));
    }
  },

  ReferencedIdentifier(path, asset) {
    if (
      path.node.name === 'exports' &&
      !path.scope.hasBinding('exports') &&
      !path.scope.getData('hasEval')
    ) {
      path.replaceWith(getExportsIdentifier(asset));
    }
  },

  ThisExpression(path, asset) {
    if (!path.scope.parent && !path.scope.getData('hasEval')) {
      path.replaceWith(getExportsIdentifier(asset));
    }
  },

  AssignmentExpression(path, asset) {
    let left = path.node.left;
    if (
      t.isIdentifier(left) &&
      left.name === 'exports' &&
      !path.scope.hasBinding('exports') &&
      !path.scope.getData('hasEval')
    ) {
      path.get('left').replaceWith(getExportsIdentifier(asset));
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

function getExportsIdentifier(asset) {
  return t.identifier('$' + asset.id + '$exports');
}
