const promisify = require('./utils/promisify');
// const builtins from './builtins';
// import _resolve from 'browser-resolve';
const resolve = promisify(require('browser-resolve'));
const builtins = require('node-libs-browser');
const path = require('path');

for (let key in builtins) {
  if (builtins[key] == null) {
    builtins[key] = require.resolve('./_empty.js');
  }
}

class Resolver {
  constructor(options = {}) {
    this.options = options;
    this.cache = new Map;
  }

  async resolve(filename, parent) {
    let key = (parent ? path.dirname(parent) : '') + ':' + filename;
    if (this.cache.has(key)) {
      // console.log('cached!', key)
      return this.cache.get(key);
    }

    var res = await resolve(filename, {
      filename: parent,
      paths: this.options.paths,
      modules: builtins
    });

    if (Array.isArray(res)) {
      res = {path: res[0], pkg: res[1]};
    } else {
      res = {path: res};
    }

    this.cache.set(key, res);
    return res;
  }
}

module.exports = Resolver;
