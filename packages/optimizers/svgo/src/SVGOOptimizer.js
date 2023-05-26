// @flow

import {Optimizer} from '@parcel/plugin';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {blobToString} from '@parcel/utils';

import * as svgo from 'svgo';

export default (new Optimizer({
  async loadConfig({config}) {
    let configFile = await config.getConfig([
      'svgo.config.js',
      'svgo.config.cjs',
      'svgo.config.mjs',
      'svgo.config.json',
    ]);

    return configFile?.contents;
  },

  async optimize({bundle, contents, config}) {
    if (!bundle.env.shouldOptimize) {
      return {contents};
    }

    let code = await blobToString(contents);
    let result;
    try {
      result = svgo.optimize(code, {
        plugins: [
          {
            name: 'preset-default',
            params: {
              overrides: {
                // Removing ids could break SVG sprites.
                cleanupIds: false,
                // <style> elements and attributes are already minified before they
                // are re-inserted by the packager.
                minifyStyles: false,
              },
            },
          },
        ],
        ...config,
      });
    } catch (e) {
      let {message, line, column} = e;
      throw new ThrowableDiagnostic({
        diagnostic: {
          message,
          codeFrames: [
            {
              code,
              language: 'svg',
              codeHighlights: [
                {
                  start: {line, column},
                  end: {line, column},
                },
              ],
            },
          ],
        },
      });
    }

    return {contents: result.data};
  },
}): Optimizer);
