var path = require('path');
var resolve = require('./bundle-manifest').resolve;

function relativePath(from, to) {
  return path.relative(path.dirname(from), to).replace(/\\/g, '/');
}

module.exports = function getRelativePath(fromId, toId) {
  return relativePath(resolve(fromId), resolve(toId));
};
