const types = require('babel-types');

// from babel-types. remove when we upgrade to babel 7.
// https://github.com/babel/babel/blob/0189b387026c35472dccf45d14d58312d249f799/packages/babel-types/src/index.js#L347
module.exports = function matchesPattern(member, match, allowPartial) {
  // not a member expression
  if (!types.isMemberExpression(member)) return false;

  const parts = Array.isArray(match) ? match : match.split('.');
  const nodes = [];

  let node;
  for (node = member; types.isMemberExpression(node); node = node.object) {
    nodes.push(node.property);
  }
  nodes.push(node);

  if (nodes.length < parts.length) return false;
  if (!allowPartial && nodes.length > parts.length) return false;

  for (let i = 0, j = nodes.length - 1; i < parts.length; i++, j--) {
    const node = nodes[j];
    let value;
    if (types.isIdentifier(node)) {
      value = node.name;
    } else if (types.isStringLiteral(node)) {
      value = node.value;
    } else {
      return false;
    }

    if (parts[i] !== value) return false;
  }

  return true;
};
