const types = require('babel-types');

module.exports = {
  VariableDeclarator(node, asset) {
    const {init, id} = node;

    if (
      types.isCallExpression(init) &&
      types.isIdentifier(init.callee) &&
      init.callee.name === 'require'
    ) {
      let external = getExternal(init.arguments[0].value, asset, id.name);
      if (external) {
        node.init = types.identifier(external);
      }
    }
  }
};

function getExternal(value, asset, fallback) {
  let externalValue = asset.options.rootPackage.externals[value];
  if (externalValue === false) return fallback;
  return externalValue;
}
