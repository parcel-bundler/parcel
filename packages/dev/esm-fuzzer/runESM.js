'use strict';
const vm = require('vm');
const path = require('path');
const nativeFS = require('fs');

module.exports = async function runESM({
  entries,
  globals,
  fs = nativeFS,
  externalModules = {},
}) {
  const context = vm.createContext(globals ?? {});

  const cache = new Map();
  function load(specifier, referrer) {
    if (path.isAbsolute(specifier) || specifier.startsWith('.')) {
      if (!path.extname(specifier)) specifier = specifier + '.js';

      const filename = path.resolve(
        path.dirname(referrer.identifier),
        specifier,
      );
      if (cache.has(filename)) {
        return cache.get(filename);
      }
      const source = fs.readFileSync(filename, 'utf8');
      const m = new vm.SourceTextModule(source, {
        identifier: filename,
        importModuleDynamically: entry,
        context: context,
      });
      cache.set(filename, m);
      return m;
    } else {
      if (!(specifier in externalModules)) {
        console.error(
          `Couldn't resolve ${specifier} from ${referrer.identifier}`,
        );
        throw new Error(
          `Couldn't resolve ${specifier} from ${referrer.identifier}`,
        );
      }

      if (cache.has(specifier)) {
        return cache.get(specifier);
      }

      let ns = externalModules[specifier](context);

      let m = new vm.SyntheticModule(
        Object.keys(ns),
        function() {
          for (let [k, v] of Object.entries(ns)) {
            this.setExport(k, v);
          }
        },
        {identifier: specifier, context},
      );
      cache.set(specifier, m);
      return m;
    }
  }

  async function entry(specifier, referrer) {
    const m = load(specifier, referrer);
    if (m.status === 'unlinked') {
      await m.link(load);
    }
    if (m.status === 'linked') {
      await m.evaluate();
    }
    return m;
  }

  let modules = [];
  for (let f of [].concat(entries)) {
    modules.push(await entry(f, {identifier: ''}));
  }

  for (let m of modules) {
    if (m.status === 'errored') {
      throw module.error;
    }
  }

  return {
    context,
    exports: Array.isArray(entries)
      ? modules.map(m => m.namespace)
      : modules[0].namespace,
  };
};
