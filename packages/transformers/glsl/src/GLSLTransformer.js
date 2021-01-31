// @flow

import path from 'path';
import {promisify} from '@parcel/utils';
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async transform({asset, options, resolve}) {
    asset.type = 'js';

    let glslifyDeps = await options.packageManager.require(
      'glslify-deps',
      asset.filePath,
      {
        shouldAutoInstall: options.shouldAutoInstall,
      },
    );

    // Parse and collect dependencies with glslify-deps
    let cwd = path.dirname(asset.filePath);
    let depper = glslifyDeps({
      cwd,
      resolve: async (target, opts, next) => {
        try {
          let filePath = await resolve(asset.filePath, target);

          next(null, filePath);
        } catch (err) {
          next(err);
        }
      },
    });

    let ast = await promisify(depper.inline.bind(depper))(
      await asset.getCode(),
      cwd,
    );

    let glslifyBundle = await options.packageManager.require(
      'glslify-bundle',
      asset.filePath,
      {
        shouldAutoInstall: options.shouldAutoInstall,
      },
    );

    collectDependencies(asset, ast);

    // Generate the bundled glsl file
    let glsl = await glslifyBundle(ast);

    asset.setCode(`module.exports=${JSON.stringify(glsl)};`);

    return [asset];
  },
}): Transformer);

function collectDependencies(asset, ast) {
  for (let dep of ast) {
    if (!dep.entry) {
      asset.addIncludedFile(dep.file);
    }
  }
}
