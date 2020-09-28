// @flow

import path from 'path';
import {promisify} from '@parcel/utils';
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async parse({asset, options}) {
    let glslifyDeps = await options.packageManager.require(
      'glslify-deps',
      asset.filePath,
      {
        autoinstall: options.autoinstall,
      },
    );

    // Parse and collect dependencies with glslify-deps
    let cwd = path.dirname(asset.filePath);
    let depper = glslifyDeps({cwd});

    return promisify(depper.inline.bind(depper))(await asset.getCode(), cwd);
  },

  async transform({asset, options}) {
    asset.type = 'js';

    let glslifyBundle = await options.packageManager.require(
      'glslify-bundle',
      asset.filePath,
      {
        autoinstall: options.autoinstall,
      },
    );

    // Generate the bundled glsl file
    let glsl = await glslifyBundle(await asset.getAST());

    asset.setCode(`module.exports=${JSON.stringify(glsl)};`);

    return [asset];
  },
}): Transformer);
