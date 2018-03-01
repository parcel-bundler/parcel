const {mix} = require('mixwith');
const path = require('path');
const config = require('./utils/config');
const localRequire = require('./utils/localRequire');

const isFunction = value => typeof value === 'function';
const isClass = value =>
  isFunction(value) && value.toString().startsWith('class ');
const isObject = value => typeof value === 'object';

const getClassName = klass => klass.name;

class Plugins {
  constructor() {
    this.initialized = false;
    this.plugins = new Map();
  }

  async init(mainFile) {
    const plugins = await this.loadPlugins(mainFile);

    for (const plugin of plugins) {
      let resolved = await localRequire(plugin, mainFile);

      // "Legacy" plugin support
      if (isFunction(resolved)) {
        const p = await localRequire(plugin, mainFile);
        resolved = {
          Bundler: class {
            async legacyPlugin() {
              await p(this);
              if (super.legacyPlugin) {
                await super.legacyPlugin();
              }
            }
          }
        };
      }

      // Add plugins to collection
      if (isObject(resolved)) {
        for (const key in resolved) {
          const loaded = this.plugins.get(key) || [];
          loaded.push(resolved[key]);
          this.plugins.set(key, loaded);
        }
      }
    }

    this.initialized = true;
  }

  async loadPlugins(mainFile) {
    const plugins = [];

    const pkg = await config.load(path.resolve(mainFile || ''), [
      'package.json'
    ]);
    if (!pkg) {
      return plugins;
    }

    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);

    for (let dep in deps) {
      if (dep.startsWith('parcel-plugin-')) {
        plugins.push(dep);
      }
    }

    return plugins;
  }

  apply(klass) {
    if (!isClass(klass)) {
      return klass;
    }

    if (!this.initialized) {
      // throw new Error('Plugins must be initialized with `init` before using `apply`');
    }

    // Return unaltered when no matching plugins
    const className = getClassName(klass);
    if (!this.plugins.has(className)) {
      return klass;
    }

    // Apply and return super class with plugins mixed in
    const classPlugins = this.plugins.get(className);
    return class extends mix(klass).with(...classPlugins) {};
  }
}

module.exports = new Plugins();
