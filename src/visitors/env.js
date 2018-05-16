const types = require('babel-types');
const matchesPattern = require('./matches-pattern');
const morph = require('../utils/morph');

module.exports = {
  MemberExpression(node, asset) {
    // Inline environment variables accessed on process.env
    if (matchesPattern(node.object, 'process.env') && asset.options.target === 'browser') {
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
