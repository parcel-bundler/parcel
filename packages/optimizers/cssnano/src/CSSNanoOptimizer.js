// @flow strict-local

import SourceMap from '@parcel/source-map';
import {Optimizer} from '@atlaspack/plugin';
import postcss from 'postcss';
import cssnano from 'cssnano';
import type {CSSNanoOptions} from 'cssnano'; // TODO the type is based on cssnano 4

export default (new Optimizer({
  async loadConfig({config}) {
    const configFile = await config.getConfig(
      [
        '.cssnanorc',
        'cssnano.config.json',
        'cssnano.config.js',
        'cssnano.config.cjs',
        'cssnano.config.mjs',
      ],
      {
        packageKey: 'cssnano',
      },
    );
    if (configFile) {
      return configFile.contents;
    }
  },

  async optimize({
    bundle,
    contents: prevContents,
    getSourceMapReference,
    map: prevMap,
    config,
    options,
  }) {
    if (!bundle.env.shouldOptimize) {
      return {contents: prevContents, map: prevMap};
    }

    if (typeof prevContents !== 'string') {
      throw new Error(
        'CSSNanoOptimizer: Only string contents are currently supported',
      );
    }

    const result = await postcss([
      cssnano((config ?? {}: CSSNanoOptions)),
    ]).process(prevContents, {
      // Suppress postcss's warning about a missing `from` property. In this
      // case, the input map contains all of the sources.
      from: undefined,
      map: {
        annotation: false,
        inline: false,
        prev: prevMap ? await prevMap.stringify({}) : null,
      },
    });

    let map;
    if (result.map != null) {
      map = new SourceMap(options.projectRoot);
      map.addVLQMap(result.map.toJSON());
    }

    let contents = result.css;
    if (bundle.env.sourceMap) {
      let reference = await getSourceMapReference(map);
      if (reference != null) {
        contents += '\n' + '/*# sourceMappingURL=' + reference + ' */\n';
      }
    }

    return {
      contents,
      map,
    };
  },
}): Optimizer);
