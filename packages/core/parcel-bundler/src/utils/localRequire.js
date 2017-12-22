const {dirname} = require('path');
const resolve = require('resolve');
const install = require('./installPackage');

const cache = new Map();

async function localRequire(name, path, triedInstall = false) {
  let basedir = dirname(path);
  let key = basedir + ':' + name;
  let resolved = cache.get(key);
  if (!resolved) {
    try {
      resolved = resolve.sync(name, {basedir});
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND' && !triedInstall) {
        await install(path, name);
        return localRequire(name, path, true);
      }
      throw e;
    }
    cache.set(key, resolved);
  }

  return require(resolved);
}

module.exports = localRequire;
