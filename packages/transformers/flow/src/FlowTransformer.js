// @flow
import type {PackageJSON} from '@parcel/types';
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async loadConfig({config, options}) {
    if (!config.isSource) {
      config.setResult(false);
      return;
    }

    // Only run flow if `flow-bin` is listed as a dependency in the root package.json
    let pkg: ?PackageJSON = (
      await config.getConfigFrom(options.projectRoot + '/index', [
        'package.json',
      ])
    )?.contents;

    let shouldStripFlow =
      pkg?.dependencies?.['flow-bin'] != null ||
      pkg?.devDependencies?.['flow-bin'] != null;

    config.setResult(shouldStripFlow);
    if (shouldStripFlow) {
      config.addDevDependency({
        moduleSpecifier: 'flow-remove-types',
        resolveFrom: options.projectRoot + '/index',
      });
    }
  },

  async transform({asset, config, options}) {
    if (!config) {
      return [asset];
    }

    let [code, flowRemoveTypes] = await Promise.all([
      asset.getCode(),
      options.packageManager.require(
        'flow-remove-types',
        options.projectRoot + '/index',
        {
          shouldAutoInstall: options.shouldAutoInstall,
          saveDev: true,
        },
      ),
    ]);

    // This replaces removed code sections with spaces, so all source positions
    // remain valid and no sourcemap is needed.
    asset.setCode(flowRemoveTypes(code).toString());

    return [asset];
  },
}): Transformer);
