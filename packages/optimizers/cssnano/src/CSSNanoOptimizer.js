// @flow strict-local

import SourceMap from '@parcel/source-map';
import {Optimizer} from '@parcel/plugin';
import postcss from 'postcss';
// flowlint-next-line untyped-import:off
import cssnano from 'cssnano';

export default new Optimizer({
  async optimize({
    bundle,
    contents: prevContents,
    getSourceMapReference,
    map: prevMap,
    options,
  }) {
    if (!bundle.env.minify) {
      return {contents: prevContents, map: prevMap};
    }

    if (typeof prevContents !== 'string') {
      throw new Error(
        'CSSNanoOptimizer: Only string contents are currently supported',
      );
    }

    const result = await postcss([cssnano]).process(prevContents, {
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
      map = new SourceMap();
      map.addRawMappings(result.map.toJSON());
    }

    let contents = result.css;
    if (options.sourceMaps) {
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
});
