const isGlob = require('is-glob');

exports.isGlob = function(filename) {
  return isGlob(filename, {
    strict: true
  });
};

exports.glob = require('fast-glob');
