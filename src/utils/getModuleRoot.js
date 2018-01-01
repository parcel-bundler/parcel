const path = require('path');

module.exports = function(location, fallback = path.dirname(location)) {
  location = path.dirname(location);
  if (location.indexOf('node_modules') >= 0) {
    let dirs = location.split('/');
    for (let i = 0; i < dirs.length; i++) {
      let dir = dirs[i];
      if (dir === 'node_modules') {
        dirs.splice(i + 2);
        return dirs.join('/');
      }
    }
  } else {
    // This is not part of a node module
    return fallback;
  }
};
