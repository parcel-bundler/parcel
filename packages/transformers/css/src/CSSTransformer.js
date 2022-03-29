// @flow strict-local

import path from 'path';
import SourceMap from '@parcel/source-map';
import {Transformer} from '@parcel/plugin';
import {
  transform,
  transformStyleAttribute,
  browserslistToTargets,
} from '@parcel/css';
import {remapSourceLocation, relativePath} from '@parcel/utils';
import browserslist from 'browserslist';
import nullthrows from 'nullthrows';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';

export default (new Transformer({
  async loadConfig({config, options}) {
    let conf = await config.getConfigFrom(options.projectRoot + '/index', [], {
      packageKey: '@parcel/transformer-css',
    });
    return conf?.contents;
  },
  async transform({asset, config, options}) {
    // Normalize the asset's environment so that properties that only affect JS don't cause CSS to be duplicated.
    // For example, with ESModule and CommonJS targets, only a single shared CSS bundle should be produced.
    let env = asset.env;
    asset.setEnvironment({
      context: 'browser',
      engines: {
        browsers: asset.env.engines.browsers,
      },
      shouldOptimize: asset.env.shouldOptimize,
      shouldScopeHoist: asset.env.shouldScopeHoist,
      sourceMap: asset.env.sourceMap,
    });

    let [code, originalMap] = await Promise.all([
      asset.getBuffer(),
      asset.getMap(),
    ]);

    let targets = getTargets(asset.env.engines.browsers);
    let res;
    try {
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
            (asset.meta.cssModulesCompiled == null &&
              /\.module\./.test(asset.filePath)),
          analyzeDependencies: asset.meta.hasDependencies !== false,
          sourceMap: !!asset.env.sourceMap,
          drafts: config?.drafts,
          pseudoClasses: config?.pseudoClasses,
          targets,
        });
      }
    } catch (err) {
      err.filePath = asset.filePath;
      let diagnostic = errorToDiagnostic(err, {
        origin: '@parcel/transformer-css',
      });
      if (err.data?.type === 'AmbiguousUrlInCustomProperty' && err.data.url) {
        let p =
          '/' +
          relativePath(
            options.projectRoot,
            path.resolve(path.dirname(asset.filePath), err.data.url),
            false,
          );
        diagnostic[0].hints = [`Replace with: url(${p})`];
        diagnostic[0].documentationURL =
          'https://parceljs.org/languages/css/#url()';
      }

      throw new ThrowableDiagnostic({
        diagnostic,
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

        if (dep.type === 'import' && !res.exports) {
          asset.addDependency({
            specifier: dep.url,
            specifierType: 'url',
            loc,
            meta: {
              // For the glob resolver to distinguish between `@import` and other URL dependencies.
              isCSSImport: true,
              media: dep.media,
            },
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
      let locals = new Map();
      let c = 0;
      let depjs = '';
      let js = '';

      let jsDeps = [];

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
            }
            s += '${' + `${d}[${JSON.stringify(ref.name)}]` + '}';
          }
        }

        s += '`;\n';

        // If the export is referenced internally (e.g. used @keyframes), add a self-reference
        // to the JS so the symbol is retained during tree-shaking.
        if (e.isReferenced) {
          s += `module.exports[${JSON.stringify(key)}];\n`;
        }

        js += s;
      };

      for (let key in exports) {
        asset.symbols.set(key, exports[key].name);
        add(key);
      }

      if (res.dependencies) {
        for (let dep of res.dependencies) {
          if (dep.type === 'import') {
            // TODO: Figure out how to treeshake this
            let d = `dep_$${c++}`;
            depjs += `import * as ${d} from ${JSON.stringify(dep.url)};\n`;
            js += `for (let key in ${d}) { if (key in module.exports) module.exports[key] += ' ' + ${d}[key]; else module.exports[key] = ${d}[key]; }\n`;
            asset.symbols.set('*', '*');
          }
        }
      }

      assets.push({
        type: 'js',
        content: depjs + js,
        dependencies: jsDeps,
        env,
      });
    }

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
