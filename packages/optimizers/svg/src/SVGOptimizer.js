// @flow strict-local
import {Optimizer} from '@parcel/plugin';
import {blobToBuffer, convertSVGOConfig} from '@parcel/utils';
import {optimizeSvg} from '@parcel/rust';

export default (new Optimizer({
  async loadConfig({config}) {
    let configFile = await config.getConfig([
      'svgo.config.js',
      'svgo.config.cjs',
      'svgo.config.mjs',
      'svgo.config.json',
    ]);

    return convertSVGOConfig(configFile?.contents);
  },
  async optimize({bundle, contents, map, config}) {
    if (!bundle.env.shouldOptimize) {
      return {contents, map};
    }

    let code = await blobToBuffer(contents);
    let res = optimizeSvg({
      code,
      config,
    });

    return {
      contents: res.code,
    };
  },
}): Optimizer);
