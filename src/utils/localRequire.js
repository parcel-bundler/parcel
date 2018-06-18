const {dirname} = require('path');
const promisify = require('../utils/promisify');
const resolve = promisify(require('resolve'));
const worker = require('../worker');

const cache = new Map();

async function localRequire(name, path, triedInstall = false) {
  let basedir = dirname(path);
  let key = basedir + ':' + name;
  let resolved = cache.get(key);
  if (!resolved) {
    try {
      resolved = await resolve(name, {basedir}).then(([name]) => name);
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND' && !triedInstall) {
        await worker.addCall({
          location: require.resolve('./installPackage.js'),
          args: [[name], path]
        });
        return localRequire(name, path, true);
      }
      throw e;
    }
    cache.set(key, resolved);
  }

  return require(resolved);
}

module.exports = localRequire;
