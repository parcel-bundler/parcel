const isGlob = require('is-glob');
const fastGlob = require('fast-glob');

function normalisePath(p) {
  return p.replace(/\\/g, '/');
}

exports.isGlob = function(p) {
  return isGlob(normalisePath(p));
};

exports.glob = function(p, options) {
  return fastGlob(normalisePath(p), options);
};

exports.glob.sync = function(p, options) {
  return fastGlob.sync(normalisePath(p), options);
};
