const types = require('@babel/types');

module.exports = {
  MemberExpression(path, asset) {
    const {node} = path;
    // Inline environment variables accessed on process.env
    if (
      types.matchesPattern(node.object, 'process.env') &&
      !types.isAssignmentExpression(path.parent)
    ) {
      let key = types.toComputedKey(node);
      if (types.isStringLiteral(key)) {
        let prop = process.env[key.value];
        if (typeof prop !== 'function') {
          let value = types.valueToNode(prop);
          morph(node, value);
          asset.isAstDirty = true;
          asset.cacheData.env[key.value] = process.env[key.value];
          if (types.isUnaryExpression(path.parent, {operator: '!'})) {
            path = path.parentPath;
          }
          if (
            types.isConditionalExpression(path.parent) ||
            types.isIfStatement(path.parent)
          ) {
            const result = path.evaluate();
            if (result.confident) {
              if (result.value && path.parent.consequent) {
                path.parentPath.replaceWith(path.parent.consequent);
              } else if (!result.value && path.parent.alternate) {
                path.parentPath.replaceWith(path.parent.alternate);
              } else {
                path.parentPath.remove();
              }
            }
          }
        }
      }
    }
  }
};

// replace object properties
function morph(object, newProperties) {
  for (let key in object) {
    delete object[key];
  }

  for (let key in newProperties) {
    object[key] = newProperties[key];
  }
}
