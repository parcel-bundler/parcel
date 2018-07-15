const types = require('babel-types');
const matchesPattern = require('./matches-pattern');

module.exports = {
  MemberExpression(node, asset) {
    // Inline environment variables accessed on process.env
    if (matchesPattern(node.object, 'process.env')) {
      let key = types.toComputedKey(node);
      if (types.isStringLiteral(key)) {
        let val = types.valueToNode(process.env[key.value]);
        morph(node, val);
        asset.isAstDirty = true;
        asset.cacheData.env[key.value] = process.env[key.value];
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
