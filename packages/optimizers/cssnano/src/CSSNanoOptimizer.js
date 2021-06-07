// @flow strict-local

import SourceMap from '@parcel/source-map';
import {Optimizer} from '@parcel/plugin';
import postcss from 'postcss';
import cssnano from 'cssnano';
import {loadConfig} from '@parcel/utils';
import path from 'path';

export default (new Optimizer({
  async optimize({
    bundle,
    contents: prevContents,
    getSourceMapReference,
    map: prevMap,
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

    const userConfig =
      (await loadConfig(
        options.inputFS,
        path.join(options.entryRoot, 'index.css'),
        ['.cssnanorc ', 'cssnano.config.json', 'cssnano.config.js'],
        options.projectRoot,
      )) ?? {};

    const result = await postcss([cssnano(userConfig)]).process(prevContents, {
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
