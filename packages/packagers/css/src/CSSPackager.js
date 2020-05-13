// @flow

import path from 'path';
import SourceMap from '@parcel/source-map';
import {Packager} from '@parcel/plugin';
import {
  PromiseQueue,
  countLines,
  replaceInlineReferences,
  replaceURLReferences,
} from '@parcel/utils';

export default new Packager({
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    options,
    getSourceMapReference,
  }) {
    let queue = new PromiseQueue({maxConcurrent: 32});
    bundle.traverseAssets({
      exit: asset => {
        // Figure out which media types this asset was imported with.
        // We only want to import the asset once, so group them all together.
        let media = [];
        for (let dep of bundleGraph.getIncomingDependencies(asset)) {
          if (!dep.meta.media) {
            // Asset was imported without a media type. Don't wrap in @media.
            media.length = 0;
            break;
          }
          media.push(dep.meta.media);
        }

        queue.add(() =>
          Promise.all([
            asset,
            asset.getCode().then((css: string) => {
              if (media.length) {
                return `@media ${media.join(', ')} {\n${css}\n}\n`;
              }

              return css;
            }),
            options.sourceMaps && asset.getMapBuffer(),
          ]),
        );
      },
    });

    let outputs = await queue.run();
    let contents = '';
    let map = new SourceMap();
    let lineOffset = 0;
    for (let [asset, code, mapBuffer] of outputs) {
      contents += code + '\n';
      if (options.sourceMaps) {
        if (mapBuffer) {
          map.addBufferMappings(mapBuffer, lineOffset);
        } else {
          map.addEmptyMap(
            path
              .relative(options.projectRoot, asset.filePath)
              .replace(/\\+/g, '/'),
            code,
            lineOffset,
          );
        }

        lineOffset += countLines(code);
      }
    }

    if (options.sourceMaps) {
      let reference = await getSourceMapReference(map);
      if (reference != null) {
        contents += '/*# sourceMappingURL=' + reference + ' */\n';
      }
    }

    ({contents, map} = replaceURLReferences({
      bundle,
      bundleGraph,
      contents,
      map,
    }));

    return replaceInlineReferences({
      bundle,
      bundleGraph,
      contents,
      getInlineBundleContents,
      getInlineReplacement: (dep, inlineType, contents) => ({
        from: dep.id,
        to: contents,
      }),
      map,
    });
  },
});
