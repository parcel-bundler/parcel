const glob = require('glob');
const promisify = require('./promisify');

exports.isGlob = function(filename) {
  return /[*+{}]/.test(filename) && glob.hasMagic(filename);
};
exports.glob = promisify(glob);
