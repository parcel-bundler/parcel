// @flow
import {Transformer} from '@parcel/plugin';
import {transform} from '../parcel-swc.node';
import {isURL} from '@parcel/utils';
import path from 'path';
import browserslist from 'browserslist';
import semver from 'semver';

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

        let [major, minor = '0', patch = '0'] = version.split('.');
        let semverVersion = `${major}.${minor}.${patch}`;

        if (targets[name] == null || semver.gt(targets[name], semverVersion)) {
          targets[name] = semverVersion;
        }
      }
    } else if (asset.env.isNode() && asset.env.engines.node) {
      targets = {node: semver.minVersion(asset.env.engines.node)?.toString()};
    }

    let {dependencies, code: compiledCode, shebang} = transform({
      filename: asset.filePath,
      code,
      replaceEnv: !asset.env.isNode(),
      isBrowser: asset.env.isBrowser(),
      env: options.env,
      isTypeScript: asset.type === 'ts' || asset.type === 'tsx',
      isJSX: Boolean(config?.isJSX),
      jsxPragma: config?.pragma,
      jsxPragmaFrag: config?.pragmaFrag,
      isDevelopment: options.mode === 'development',
      targets,
    });

    // console.log(Object.keys(options.env))

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

        let meta;
        if (dep.attributes) {
          meta = {
            importAttributes: dep.attributes,
          };
        }

        asset.addDependency({
          moduleSpecifier: dep.specifier,
          loc: dep.loc,
          isAsync: dep.kind === 'DynamicImport',
          isOptional: dep.isOptional,
          meta,
        });
      }
    }

    asset.type = 'js';
    asset.setCode(compiledCode);

    return [asset];
  },
}): Transformer);
