// Matches files (ie: xxxxx.ext)
const FILE_REGEXP = /^\S*\.[A-z]*/;

module.exports = function(path) {
  return FILE_REGEXP.test(path);
};
