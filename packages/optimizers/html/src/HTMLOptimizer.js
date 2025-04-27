// @flow strict-local
import {Optimizer} from '@parcel/plugin';
import {blobToBuffer, convertSVGOConfig} from '@parcel/utils';
import {optimizeHtml} from '@parcel/rust';
import path from 'path';

export default (new Optimizer({
  async loadConfig({config, options}) {
    let userConfig = await config.getConfigFrom(
      path.join(options.projectRoot, 'index.html'),
      [
        '.htmlnanorc',
        '.htmlnanorc.json',
        '.htmlnanorc.js',
        '.htmlnanorc.cjs',
        '.htmlnanorc.mjs',
        'htmlnano.config.js',
        'htmlnano.config.cjs',
        'htmlnano.config.mjs',
      ],
      {
        packageKey: 'htmlnano',
      },
    );

    let contents = userConfig?.contents;

    if (userConfig && contents && typeof contents === 'object') {
      contents.minifySvg = await convertSVGOConfig(
        contents.minifySvg,
        userConfig.filePath,
        path.extname(userConfig.filePath) === 'package.json'
          ? '/htmlnano/minifySvg'
          : '/minifySvg',
        options.inputFS,
        'Use the legacy @parcel/optimizer-htmlnano instead of @parcel/optimizer-html if needed.',
      );
    }

    return contents;
  },
  async optimize({bundle, contents, map, config}) {
    if (!bundle.env.shouldOptimize) {
      return {contents, map};
    }

    let code = await blobToBuffer(contents);
    let res = optimizeHtml({
      code,
      xml: bundle.type === 'xhtml',
      config,
    });

    return {
      contents: res.code,
    };
  },
}): Optimizer);
