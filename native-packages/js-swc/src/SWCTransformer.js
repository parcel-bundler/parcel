// @flow
import type {JSONObject} from '@parcel/types';
import SourceMap from '@parcel/source-map';
import {Transformer} from '@parcel/plugin';
import {transform} from '../parcel-swc.node';
import {isURL, relativeUrl} from '@parcel/utils';
import path from 'path';
import browserslist from 'browserslist';
import semver from 'semver';
import nullthrows from 'nullthrows';

const JSX_EXTENSIONS = {
  '.jsx': true,
  '.tsx': true,
};

const JSX_PRAGMA = {
  react: {
    pragma: 'React.createElement',
    pragmaFrag: 'React.Fragment',
  },
  preact: {
    pragma: 'h',
    pragmaFrag: 'Fragment',
  },
  nervjs: {
    pragma: 'Nerv.createElement',
    pragmaFrag: undefined,
  },
  hyperapp: {
    pragma: 'h',
    pragmaFrag: undefined,
  },
};

const BROWSER_MAPPING = {
  and_chr: 'chrome',
  and_ff: 'firefox',
  ie_mob: 'ie',
  ios_saf: 'ios',
  and_qq: null,
  and_uc: null,
  baidu: null,
  bb: null,
  kaios: null,
  op_mini: null,
};

export default (new Transformer({
  async loadConfig({config}) {
    let pkg = await config.getPackage();
    let reactLib;
    if (pkg?.alias && pkg.alias['react']) {
      // e.g.: `{ alias: { "react": "preact/compat" } }`
      reactLib = 'react';
    } else {
      // Find a dependency that we can map to a JSX pragma
      reactLib = Object.keys(JSX_PRAGMA).find(
        libName =>
          pkg &&
          ((pkg.dependencies && pkg.dependencies[libName]) ||
            (pkg.devDependencies && pkg.devDependencies[libName])),
      );
    }

    let pragma = reactLib ? JSX_PRAGMA[reactLib].pragma : undefined;
    let pragmaFrag = reactLib ? JSX_PRAGMA[reactLib].pragmaFrag : undefined;
    let isJSX = pragma || JSX_EXTENSIONS[path.extname(config.searchPath)];
    config.setResult({
      isJSX,
      pragma,
      pragmaFrag,
    });
  },
  async transform({asset, config, options}) {
    // When this asset is an bundle entry, allow that bundle to be split to load shared assets separately.
    // Only set here if it is null to allow previous transformers to override this behavior.
    if (asset.isSplittable == null) {
      asset.isSplittable = true;
    }

    let code = await asset.getCode();

    let targets = null;
    if (asset.env.isElectron() && asset.env.engines.electron) {
      targets = {
        electron: semver.minVersion(asset.env.engines.electron)?.toString(),
      };
    } else if (asset.env.isBrowser() && asset.env.engines.browsers) {
      targets = {};
      let browsers = browserslist(asset.env.engines.browsers);
      for (let browser of browsers) {
        let [name, version] = browser.split(' ');
        if (BROWSER_MAPPING.hasOwnProperty(name)) {
          name = BROWSER_MAPPING[name];
          if (!name) {
            continue;
          }
        }

        let [major, minor = '0', patch = '0'] = version
          .split('-')[0]
          .split('.');
        let semverVersion = `${major}.${minor}.${patch}`;

        if (targets[name] == null || semver.gt(targets[name], semverVersion)) {
          targets[name] = semverVersion;
        }
      }
    } else if (asset.env.isNode() && asset.env.engines.node) {
      targets = {node: semver.minVersion(asset.env.engines.node)?.toString()};
    }

    let relativePath = relativeUrl(options.projectRoot, asset.filePath);
    let {
      dependencies,
      code: compiledCode,
      map,
      shebang,
      hoist_result,
    } = transform({
      filename: asset.filePath,
      code,
      module_id: asset.id,
      replace_env: !asset.env.isNode(),
      is_browser: asset.env.isBrowser(),
      env: options.env,
      is_type_script: asset.type === 'ts' || asset.type === 'tsx',
      is_jsx: Boolean(config?.isJSX),
      jsx_pragma: config?.pragma,
      jsx_pragma_frag: config?.pragmaFrag,
      is_development: options.mode === 'development',
      targets,
      source_maps: !!asset.env.sourceMap,
    });

    // console.log(Object.keys(options.env))
    // console.log(asset.filePath, hoist_result, code, compiledCode);

    if (shebang) {
      asset.meta.interpreter = shebang;
    }

    // console.log(asset.filePath, dependencies);

    for (let dep of dependencies) {
      if (dep.kind === 'WebWorker') {
        asset.addURLDependency(dep.specifier, {
          loc: dep.loc,
          env: {
            context: 'web-worker',
            // outputFormat:
            //   isModule && asset.env.scopeHoist ? 'esmodule' : undefined,
          },
          meta: {
            webworker: true,
          },
        });
      } else if (dep.kind === 'ServiceWorker') {
        asset.addURLDependency(dep.specifier, {
          loc: dep.loc,
          isEntry: true,
          env: {context: 'service-worker'},
        });
      } else if (dep.kind === 'ImportScripts') {
        if (asset.env.isWorker()) {
          asset.addURLDependency(dep.specifier, {
            loc: dep.loc,
          });
        }
      } else {
        if (dep.kind === 'DynamicImport' && isURL(dep.specifier)) {
          continue;
        }

        let meta: JSONObject = {kind: dep.kind};
        if (dep.attributes) {
          meta.importAttributes = dep.attributes;
        }

        asset.addDependency({
          moduleSpecifier: dep.specifier,
          loc: dep.loc,
          isAsync: dep.kind === 'DynamicImport',
          isOptional: dep.is_optional,
          meta,
        });
      }
    }

    if (hoist_result) {
      let convertLoc = loc => ({
        filePath: relativePath,
        start: {
          line: loc.start_line,
          column: loc.start_col,
        },
        end: {
          line: loc.end_line,
          column: loc.end_col,
        },
      });

      asset.symbols.ensure();
      for (let symbol in hoist_result.exported_symbols) {
        let [local, loc] = hoist_result.exported_symbols[symbol];
        asset.symbols.set(symbol, local, convertLoc(loc));
      }

      let deps = new Map(
        asset.getDependencies().map(dep => [dep.moduleSpecifier, dep]),
      );
      for (let dep of deps.values()) {
        dep.symbols.ensure();
      }

      for (let name in hoist_result.imported_symbols) {
        let [moduleSpecifier, exported, loc] = hoist_result.imported_symbols[
          name
        ];
        let dep = deps.get(moduleSpecifier);
        if (!dep) continue;
        dep.symbols.set(exported, name, convertLoc(loc));
      }

      for (let [
        name,
        moduleSpecifier,
        exported,
        loc,
      ] of hoist_result.re_exports) {
        let dep = deps.get(moduleSpecifier);
        if (!dep) continue;

        if (name === '*' && exported === '*') {
          dep.symbols.set('*', '*', convertLoc(loc), true);
        } else {
          let reExportName =
            dep.symbols.get(exported)?.local ??
            `$${asset.id}$re_export$${name}`;
          asset.symbols.set(name, reExportName);
          dep.symbols.set(exported, reExportName, convertLoc(loc), true);
        }
      }

      for (let moduleSpecifier of hoist_result.wrapped_requires) {
        let dep = deps.get(moduleSpecifier);
        if (!dep) continue;
        dep.meta.shouldWrap = true;
      }

      for (let name in hoist_result.dynamic_imports) {
        let dep = deps.get(hoist_result.dynamic_imports[name]);
        if (!dep) continue;
        dep.meta.promiseSymbol = name;
      }

      if (hoist_result.self_references.length > 0) {
        let symbols = new Map();
        for (let name of hoist_result.self_references) {
          // Do not create a self-reference for the `default` symbol unless we have seen an __esModule flag.
          if (
            name === 'default' &&
            !asset.symbols.hasExportSymbol('__esModule')
          ) {
            continue;
          }

          let local = nullthrows(asset.symbols.get(name)).local;
          symbols.set(name, {
            local,
            isWeak: false,
            loc: null,
          });
        }

        asset.addDependency({
          moduleSpecifier: `./${path.basename(asset.filePath)}`,
          symbols,
        });
      }

      // Add * symbol if there are CJS exports, no imports/exports at all, or the asset is wrapped.
      // This allows accessing symbols that don't exist without errors in symbol propagation.
      if (
        hoist_result.has_cjs_exports ||
        (deps.size === 0 &&
          Object.keys(hoist_result.exported_symbols).length === 0) ||
        (hoist_result.should_wrap && !asset.symbols.hasExportSymbol('*'))
      ) {
        asset.symbols.set('*', `$${asset.id}$exports`);
      }

      asset.meta.staticExports = hoist_result.static_cjs_exports;
      asset.meta.shouldWrap = hoist_result.should_wrap;
      asset.meta.id = asset.id;
    }

    asset.type = 'js';
    asset.setCode(compiledCode);

    if (map) {
      let sourceMap = new SourceMap(options.projectRoot);
      sourceMap.addRawMappings(JSON.parse(map));
      asset.setMap(sourceMap);
    }

    return [asset];
  },
}): Transformer);
