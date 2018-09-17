const types = require('@babel/types');

module.exports = {
  MemberExpression(node, asset) {
    // Inline environment variables accessed on process.env
    if (types.matchesPattern(node.object, 'process.env')) {
      let key = types.toComputedKey(node);
      if (types.isStringLiteral(key)) {
        let prop = process.env[key.value];
        if (typeof prop !== 'function') {
          let value = types.valueToNode(prop);
          morph(node, value);
          asset.isAstDirty = true;
          asset.cacheData.env[key.value] = process.env[key.value];
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
