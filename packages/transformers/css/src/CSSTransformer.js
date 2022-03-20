// @flow strict-local

import path from 'path';
import SourceMap from '@parcel/source-map';
import {Transformer} from '@parcel/plugin';
import {
  transform,
  transformStyleAttribute,
  browserslistToTargets,
} from '@parcel/css';
import {remapSourceLocation} from '@parcel/utils';
import browserslist from 'browserslist';
import nullthrows from 'nullthrows';

export default (new Transformer({
  async loadConfig({config, options}) {
    let conf = await config.getConfigFrom(options.projectRoot + '/index', [], {
      packageKey: '@parcel/transformer-css',
    });
    return conf?.contents;
  },
  async transform({asset, config, options}) {
    let [code, originalMap] = await Promise.all([
      asset.getBuffer(),
      asset.getMap(),
    ]);

    let targets = getTargets(asset.env.engines.browsers);
    let res;
    if (asset.meta.type === 'attr') {
      res = transformStyleAttribute({
        code,
        analyzeDependencies: true,
        targets,
      });
    } else {
      res = transform({
        filename: path.relative(options.projectRoot, asset.filePath),
        code,
        cssModules:
          config?.cssModules ??
          (asset.meta.cssModulesCompiled !== true &&
            /\.module\./.test(asset.filePath)),
        analyzeDependencies: asset.meta.hasDependencies !== false,
        sourceMap: !!asset.env.sourceMap,
        drafts: config?.drafts,
        pseudoClasses: config?.pseudoClasses,
        targets,
      });
    }

    asset.setBuffer(res.code);

    if (res.map != null) {
      let vlqMap = JSON.parse(res.map.toString());
      let map = new SourceMap(options.projectRoot);
      map.addVLQMap(vlqMap);

      if (originalMap) {
        map.extends(originalMap);
      }

      asset.setMap(map);
    }

    if (res.dependencies) {
      for (let dep of res.dependencies) {
        let loc = dep.loc;
        if (originalMap) {
          loc = remapSourceLocation(loc, originalMap);
        }

        if (dep.type === 'import') {
          asset.addDependency({
            specifier: dep.url,
            specifierType: 'url',
            loc,
            meta: {
              // For the glob resolver to distinguish between `@import` and other URL dependencies.
              isCSSImport: true,
              media: dep.media,
            },
            symbols: new Map([['*', {local: '*', isWeak: true, loc}]]),
          });
        } else if (dep.type === 'url') {
          asset.addURLDependency(dep.url, {
            loc,
            meta: {
              placeholder: dep.placeholder,
            },
          });
        }
      }
    }

    let assets = [asset];

    if (res.exports != null) {
      let exports = res.exports;
      asset.symbols.ensure();
      asset.symbols.set('default', 'default');

      let dependencies = new Map();
      let selfReferences = new Set();
      let locals = new Map();
      let c = 0;
      let depjs = '';
      let js = '';

      let jsDeps = [];
      for (let dep of asset.getDependencies()) {
        if (dep.priority === 'sync') {
          // TODO: Figure out how to treeshake this
          let d = `dep_$${c++}`;
          depjs += `import * as ${d} from ${JSON.stringify(dep.specifier)};\n`;
          depjs += `for (let key in ${d}) { if (key in module.exports) module.exports[key] += ' ' + ${d}[key]; else module.exports[key] = ${d}[key]; }\n`;
        }
      }

      for (let key in exports) {
        locals.set(exports[key].name, key);
      }

      let seen = new Set();
      let add = key => {
        if (seen.has(key)) {
          return;
        }
        seen.add(key);

        let e = exports[key];
        let s = `module.exports[${JSON.stringify(key)}] = \`${e.name}`;

        if (e.isReferenced) {
          selfReferences.add(e.name);
        }

        for (let ref of e.composes) {
          s += ' ';
          if (ref.type === 'local') {
            add(nullthrows(locals.get(ref.name)));
            s +=
              '${' +
              `module.exports[${JSON.stringify(
                nullthrows(locals.get(ref.name)),
              )}]` +
              '}';
          } else if (ref.type === 'global') {
            s += ref.name;
          } else if (ref.type === 'dependency') {
            let d = dependencies.get(ref.specifier);
            if (d == null) {
              d = `dep_${c++}`;
              depjs += `import * as ${d} from ${JSON.stringify(
                ref.specifier,
              )};\n`;
              dependencies.set(ref.specifier, d);

              asset.addDependency({
                specifier: ref.specifier,
                specifierType: 'url',
              });
            }
            s += '${' + `${d}[${JSON.stringify(ref.name)}]` + '}';
          }
        }

        s += '`;\n';
        js += s;
      };

      for (let key in exports) {
        asset.symbols.set(key, exports[key].name);
        add(key);
      }

      assets.push({
        type: 'js',
        content: depjs + js,
        dependencies: jsDeps,
        env: asset.env,
      });

      if (selfReferences.size > 0) {
        asset.addDependency({
          specifier: `./${path.basename(asset.filePath)}`,
          specifierType: 'url',
          symbols: new Map(
            [...locals]
              .filter(([local]) => selfReferences.has(local))
              .map(([local, exported]) => [
                exported,
                {local, isWeak: false, loc: null},
              ]),
          ),
        });
      }
    }

    // Normalize the asset's environment so that properties that only affect JS don't cause CSS to be duplicated.
    // For example, with ESModule and CommonJS targets, only a single shared CSS bundle should be produced.
    asset.setEnvironment({
      context: 'browser',
      engines: {
        browsers: asset.env.engines.browsers,
      },
      shouldOptimize: asset.env.shouldOptimize,
      shouldScopeHoist: asset.env.shouldScopeHoist,
      sourceMap: asset.env.sourceMap,
    });

    return assets;
  },
}): Transformer);

let cache = new Map();

function getTargets(browsers) {
  if (browsers == null) {
    return undefined;
  }

  let cached = cache.get(browsers);
  if (cached != null) {
    return cached;
  }

  let targets = browserslistToTargets(browserslist(browsers));

  cache.set(browsers, targets);
  return targets;
}
