const {dirname} = require('path');
const resolve = require('resolve');

const cache = new Map();

function localRequire(name, path) {
  let basedir = dirname(path);
  let key = basedir + ':' + name;
  let resolved = cache.get(key);
  if (!resolved) {
    try {
      resolved = resolve.sync(name, {basedir});
    } catch (e) {
      throw e;
    }
    cache.set(key, resolved);
  }

  return require(resolved);
}

module.exports = localRequire;
