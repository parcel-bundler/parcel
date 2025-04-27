// @flow

import {Transformer} from '@parcel/plugin';

import path from 'path';
import {convertSVGOConfig} from '@parcel/utils';
import ThrowableDiagnostic, {
  md,
  generateJSONCodeHighlights,
} from '@parcel/diagnostic';
import {svgReact, hashString} from '@parcel/rust';

export default (new Transformer({
  async loadConfig({config, options}) {
    let svgrResult: any = await config.getConfig([
      '.svgrrc',
      '.svgrrc.json',
      '.svgrrc.js',
      '.svgrrc.cjs',
      '.svgrrc.mjs',
      'svgr.config.json',
      'svgr.config.js',
      'svgr.config.cjs',
      'svgr.config.mjs',
    ]);
    let svgoResult: any = await config.getConfig([
      'svgo.config.js',
      'svgo.config.cjs',
      'svgo.config.mjs',
      'svgo.config.json',
    ]);

    let svgoConfig = await convertSVGOConfig(
      svgrResult?.contents?.svgoConfig ?? svgoResult?.contents,
      svgrResult?.contents?.svgoConfig
        ? svgrResult.filePath
        : svgoResult.filePath,
      svgrResult?.contents?.svgoConfig ? '/svgoConfig' : '',
      options.inputFS,
      'Use the legacy @parcel/transformer-svg-react instead of @parcel/transformer-svg-jsx if needed.',
    );

    let svgr = svgrResult?.contents;
    if (svgoResult && svgr?.jsx) {
      throw new ThrowableDiagnostic({
        diagnostic: await createDiagnostic(
          md`
Unsupported SVGR option "jsx".
          `,
          svgrResult.filePath,
          '/jsx',
          options,
        ),
      });
    }

    if (svgr?.template) {
      throw new ThrowableDiagnostic({
        diagnostic: await createDiagnostic(
          md`
Unsupported SVGR option "template".
          `,
          svgrResult.filePath,
          '/template',
          options,
        ),
      });
    }

    // Prefix ids by default so they don't conflict between svgs.
    if (svgoConfig && svgoConfig.prefixIds == null) {
      let hash = hashString(
        path.relative(options.projectRoot, config.searchPath),
      );
      svgoConfig.prefixIds = {
        prefix: hash.slice(-6),
        prefixClassNames: false,
      };
    }

    return {svgr, svgo: svgoConfig};
  },

  async transform({asset, config}) {
    let code = await asset.getBuffer();

    let {code: jsx} = svgReact({
      code,
      config: {svgoConfig: config.svgo, ...config.svgr},
    });

    asset.type = 'jsx';
    asset.bundleBehavior = null;
    asset.setBuffer(jsx);

    return [asset];
  },
}): Transformer);

async function createDiagnostic(message, filePath, jsonPath, options) {
  return {
    message: message,
    codeFrames: [
      {
        filePath: filePath,
        codeHighlights:
          path.basename(filePath) === '.svgrrc' ||
          path.extname(filePath) === '.json'
            ? generateJSONCodeHighlights(
                await options.inputFS.readFile(filePath, 'utf8'),
                [
                  {
                    key: jsonPath,
                  },
                ],
              )
            : [],
      },
    ],
    hints: [
      'Use the legacy @parcel/transformer-svg-react instead of @parcel/transformer-svg-jsx if needed.',
    ],
  };
}
