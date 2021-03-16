// @flow

import path from 'path';
import {promisify} from 'util';
import {Transformer} from '@parcel/plugin';
import glslifyDeps from 'glslify-deps';
import glslifyBundle from 'glslify-bundle';

export default (new Transformer({
  async transform({asset, resolve}) {
    asset.type = 'js';

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
