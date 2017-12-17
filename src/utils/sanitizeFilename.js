const sanitizeFilename = require('sanitize-filename');

module.exports = function sanitize(name, replacement = '-') {
  return sanitizeFilename(name, {replacement});
};
