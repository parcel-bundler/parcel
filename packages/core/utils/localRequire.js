const {dirname} = require('path');
const {promisify} = require('util');
const resolve = promisify(require('resolve'));
const WorkerFarm = require('@parcel/workers');

const cache = new Map();

async function localRequire(name, path, triedInstall = false) {
  let resolved = await localResolve(name, path, triedInstall);
  return require(resolved);
}

async function localResolve(name, path, triedInstall = false) {
  let basedir = dirname(path);
  let key = basedir + ':' + name;
  let resolved = cache.get(key);
  if (!resolved) {
    try {
      resolved = await resolve(name, {basedir, extensions: ['.js', '.json']});
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND' && !triedInstall) {
        await WorkerFarm.callMaster({
          location: require.resolve('./installPackage.js'),
          args: [[name], path]
        });
        return await localResolve(name, path, true);
      }
      throw e;
    }
    cache.set(key, resolved);
  }

  return resolved;
}

localRequire.resolve = localResolve;
module.exports = localRequire;
