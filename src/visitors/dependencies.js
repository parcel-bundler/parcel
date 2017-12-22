const types = require('babel-types');
const template = require('babel-template');

const requireTemplate = template('require("_bundle_loader")');
const argTemplate = template('require.resolve(MODULE)');

module.exports = {
  ImportDeclaration(node, asset) {
    asset.isES6Module = true;
    addDependency(asset, node.source);
  },

  ExportNamedDeclaration(node, asset) {
    asset.isES6Module = true;
    if (node.source) {
      addDependency(asset, node.source);
    }
  },

  ExportAllDeclaration(node, asset) {
    asset.isES6Module = true;
    addDependency(asset, node.source);
  },

  ExportDefaultDeclaration(node, asset) {
    asset.isES6Module = true;
  },

  CallExpression(node, asset) {
    let {callee, arguments: args} = node;

    let isRequire =
      types.isIdentifier(callee) &&
      callee.name === 'require' &&
      args.length === 1 &&
      types.isStringLiteral(args[0]);

    if (isRequire) {
      addDependency(asset, args[0]);
    }

    let isDynamicImport =
      callee.type === 'Import' &&
      args.length === 1 &&
      types.isStringLiteral(args[0]);

    if (isDynamicImport) {
      asset.addDependency('_bundle_loader');
      addDependency(asset, args[0], {dynamic: true});

      node.callee = requireTemplate().expression;
      node.arguments[0] = argTemplate({MODULE: args[0]}).expression;
      asset.isAstDirty = true;
    }
  }
};

function addDependency(asset, node, opts = {}) {
  opts.loc = node.loc && node.loc.start;
  asset.addDependency(node.value, opts);
}
