const types = require('babel-types');

module.exports = {
  ImportDeclaration(node, asset) {
    asset.addDependency(node.source.value);
  },

  ExportNamedDeclaration(node, asset) {
    if (node.source) {
      asset.addDependency(node.source.value);
    }
  },

  ExportAllDeclaration(node, asset) {
    asset.addDependency(node.source.value);
  },

  CallExpression(node, asset) {
    let {callee, arguments: args} = node;

    let isRequire = types.isIdentifier(callee)
                 && callee.name === 'require'
                 && args.length === 1
                 && types.isStringLiteral(args[0]);

    if (isRequire) {
      asset.addDependency(args[0].value);
    }

    let isDynamicImport = callee.type === 'Import'
                       && args.length === 1
                       && types.isStringLiteral(args[0]);

    if (isDynamicImport) {
      node.callee = types.memberExpression(types.identifier('require'), types.identifier('import'));
      asset.addDependency(args[0].value, {dynamic: true});
    }
  }
};
