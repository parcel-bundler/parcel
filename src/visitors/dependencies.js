const types = require('babel-types');

module.exports = {
  ImportDeclaration(node, asset) {
    asset.dependencies.add(node.source.value);
  },

  ExportNamedDeclaration(node, asset) {
    if (node.source) {
      asset.dependencies.add(node.source.value);
    }
  },

  ExportAllDeclaration(node, asset) {
    asset.dependencies.add(node.source.value);
  },

  CallExpression(node, asset) {
    let {callee, arguments: args} = node;

    let isRequire = types.isIdentifier(callee)
                 && callee.name === 'require'
                 && args.length === 1
                 && types.isStringLiteral(args[0]);

    if (!isRequire) {
      return;
    }

    asset.dependencies.add(args[0].value);
  }
};
