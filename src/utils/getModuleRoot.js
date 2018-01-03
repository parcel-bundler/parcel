const path = require('path');
const config = require('./config');
const packageFilenames = ['package.json'];

module.exports = function(location, fallback = path.dirname(location)) {
  if (location.indexOf('node_modules') >= 0) {
    location = config.resolveSync(location, packageFilenames);
    if (location) {
      return path.dirname(location);
    }
  }
  return fallback;
};
