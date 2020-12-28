// @flow
import {Transformer} from '@parcel/plugin';
import {transform} from '../parcel-swc.node';
import {isURL} from '@parcel/utils';

export default new Transformer({
  async transform({asset, options}) {
    if (asset.env.scopeHoist) {
      return [asset];
    }

    // When this asset is an bundle entry, allow that bundle to be split to load shared assets separately.
    // Only set here if it is null to allow previous transformers to override this behavior.
    if (asset.isSplittable == null) {
      asset.isSplittable = true;
    }

    asset.type = 'js';

    let code = await asset.getCode();

    let {dependencies, code: compiledCode, shebang} = transform({
      filename: asset.filePath,
      code,
      replaceEnv: !asset.env.isNode(),
      isBrowser: asset.env.isBrowser(),
      env: options.env,
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
            loc: dep.loc
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

    asset.setCode(compiledCode);

    return [asset];
  },
});
