// @flow strict-local
import {Optimizer} from '@parcel/plugin';
import {blobToBuffer, convertSVGOConfig} from '@parcel/utils';
import {optimizeSvg} from '@parcel/rust';

export default (new Optimizer({
  async loadConfig({config, options}) {
    let configFile = await config.getConfig([
      'svgo.config.js',
      'svgo.config.cjs',
      'svgo.config.mjs',
      'svgo.config.json',
    ]);

    if (configFile) {
      return convertSVGOConfig(
        configFile.contents,
        configFile.filePath,
        '',
        options.inputFS,
        'Use the legacy @parcel/optimizer-svgo instead of @parcel/optimizer-svg if needed.',
      );
    }
  },
  async optimize({bundle, contents, map, config}) {
    if (!bundle.env.shouldOptimize) {
      return {contents, map};
    }

    let code = await blobToBuffer(contents);
    let res = optimizeSvg({
      code,
      xml: true,
      config,
    });

    return {
      contents: res.code,
    };
  },
}): Optimizer);
