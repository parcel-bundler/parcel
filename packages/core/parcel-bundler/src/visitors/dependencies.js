const types = require('babel-types');
const {resolve} = require('path');
const template = require('babel-template');

const requireTemplate = template('require("_bundle_loader")');
const argTemplate = template('require.resolve(MODULE)');

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
      asset.addDependency('_bundle_loader');
      asset.addDependency(args[0].value, {dynamic: true});

      node.callee = requireTemplate().expression;
      node.arguments[0] = argTemplate({MODULE: args[0]}).expression;
      asset.isAstDirty = true;
    }
  }
};
