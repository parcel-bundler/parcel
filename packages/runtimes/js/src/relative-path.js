var resolve = require('./bundle-manifest').resolve;

module.exports = function getRelativePath(fromId, toId) {
  return relative(dirname(resolve(fromId)), resolve(toId));
};

function dirname(_filePath) {
  if (_filePath === '') {
    return '.';
  }

  var filePath =
    _filePath[_filePath.length - 1] === '/'
      ? _filePath.slice(0, _filePath.length - 1)
      : _filePath;

  var slashIndex = filePath.lastIndexOf('/');
  return slashIndex === -1 ? '.' : filePath.slice(0, slashIndex);
}

function relative(from, to) {
  if (from === to) {
    return '';
  }

  var fromParts = from.split('/');
  if (fromParts[0] === '.') {
    fromParts.shift();
  }

  var toParts = to.split('/');
  if (toParts[0] === '.') {
    toParts.shift();
  }

  // Find where path segments diverge.
  var i;
  var divergeIndex;
  for (
    i = 0;
    (i < toParts.length || i < fromParts.length) && divergeIndex == null;
    i++
  ) {
    if (fromParts[i] !== toParts[i]) {
      divergeIndex = i;
    }
  }

  // If there are segments from "from" beyond the point of divergence,
  // return back up the path to that point using "..".
  var parts = [];
  for (i = 0; i < fromParts.length - divergeIndex; i++) {
    parts.push('..');
  }

  // If there are segments from "to" beyond the point of divergence,
  // continue using the remaining segments.
  if (toParts.length > divergeIndex) {
    parts.push.apply(parts, toParts.slice(divergeIndex));
  }

  return parts.join('/');
}

module.exports._dirname = dirname;
module.exports._relative = relative;
