const Path = require('path');

function getGlobDirname(globPath) {
  globPath = Path.dirname(globPath);
  if (Path.basename(globPath).includes('*')) {
    return getGlobDirname(globPath);
  }
  return globPath;
}

module.exports = getGlobDirname;
