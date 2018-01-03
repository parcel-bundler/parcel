const path = require('path');

module.exports = function(location, fallback = path.dirname(location)) {
  location = path.dirname(location);
  if (location.indexOf('node_modules') >= 0) {
    let matches = `${location}/`.match(
      /.*(\/|\\)node_modules(\/|\\).*(\/|\\)/g
    );
    if (matches) {
      return path.normalize(matches[0]);
    }
  }
  return fallback;
};
