const types = require('babel-types');

module.exports = {
  ImportDeclaration(node, module) {
    module.dependencies.add(node.source.value);
  },

  ExportNamedDeclaration(node, module) {
    if (node.source) {
      module.dependencies.add(node.source.value);
    }
  },

  ExportAllDeclaration(node, module) {
    module.dependencies.add(node.source.value);
  },

  CallExpression(node, module) {
    let {callee, arguments: args} = node;

    let isRequire = types.isIdentifier(callee)
                 && callee.name === 'require'
                 && args.length === 1
                 && types.isStringLiteral(args[0]);

    if (!isRequire) {
      return;
    }

    module.dependencies.add(args[0].value);
  }
};
