const isGlob = require('is-glob');
const fastGlob = require('fast-glob');

function normalisePath(p) {
  return p.replace(/\\/g, '/');
}

exports.isGlob = p => isGlob(normalisePath(p));

exports.glob = (p, options) => fastGlob(normalisePath(p), options);

exports.glob.sync = (p, options) => fastGlob.sync(normalisePath(p), options);
