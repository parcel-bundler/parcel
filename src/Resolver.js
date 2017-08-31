const promisify = require('./utils/promisify');
const resolve = promisify(require('browser-resolve'));
const builtins = require('node-libs-browser');
const path = require('path');
const glob = require('glob');

for (let key in builtins) {
  if (builtins[key] == null) {
    builtins[key] = require.resolve('./_empty.js');
  }
}

builtins['_bundle_loader'] = require.resolve('./packagers/loader.js');

class Resolver {
  constructor(options = {}) {
    this.options = options;
    this.cache = new Map;
  }

  async resolve(filename, parent) {
    let key = (parent ? path.dirname(parent) : '') + ':' + filename;
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    if (glob.hasMagic(filename)) {
      return {path: path.resolve(path.dirname(parent), filename)};
    }

    var res = await resolve(filename, {
      filename: parent,
      paths: this.options.paths,
      modules: builtins,
      extensions: ['.js', '.json']
    });

    if (Array.isArray(res)) {
      res = {path: res[0], pkg: res[1]};
    } else {
      res = {path: res, pkg: null};
    }

    this.cache.set(key, res);
    return res;
  }
}

module.exports = Resolver;
