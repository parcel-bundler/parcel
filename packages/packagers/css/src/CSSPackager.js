// @flow

import type {Root} from 'postcss';

import path from 'path';
import SourceMap from '@parcel/source-map';
import {Packager} from '@parcel/plugin';
import {
  PromiseQueue,
  countLines,
  replaceInlineReferences,
  replaceURLReferences,
} from '@parcel/utils';

import postcss from 'postcss';
import nullthrows from 'nullthrows';

export default (new Packager({
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    options,
    getSourceMapReference,
  }) {
    let queue = new PromiseQueue({
      maxConcurrent: 32,
    });
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

        queue.add(async () => {
          if (!asset.symbols.isCleared && options.mode === 'production') {
            // a CSS Modules asset

            // TODO
            // 1. Transformation.js always generates and clears the AST
            // 2. The PostCSS AST isn't serializeable as it contains functions...
            let ast: ?Root = (await asset.getAST())?.program;
            if (!ast) {
              let [code, map] = await Promise.all([
                asset.getCode(),
                asset.getMap(),
              ]);
              ast = postcss.parse(code, {
                from: asset.filePath,
                map: {
                  prev: await map?.stringify({format: 'string'}),
                },
              });
            }

            let usedSymbols = bundleGraph.getUsedSymbols(asset);
            let localSymbols = new Set(
              [...asset.symbols].map(([, {local}]) => `.${local}`),
            );
            let usedLocalSymbols =
              // we have to still support the more common default imports
              usedSymbols.has('*') || usedSymbols.has('default')
                ? null
                : new Set(
                    [...usedSymbols].map(
                      exportSymbol =>
                        `.${nullthrows(asset.symbols.get(exportSymbol)).local}`,
                    ),
                  );

            if (usedLocalSymbols) {
              ast.walkRules(rule => {
                if (
                  localSymbols.has(rule.selector) &&
                  !usedLocalSymbols.has(rule.selector)
                ) {
                  rule.remove();
                }
              });
            }

            let {content, map} = await postcss().process(ast, {
              from: undefined,
              to: options.projectRoot + '/index',
              map: {
                annotation: false,
                inline: false,
              },
              // Pass postcss's own stringifier to it to silence its warning
              // as we don't want to perform any transformations -- only generate
              stringifier: postcss.stringify,
            });

            let sourceMap;
            if (bundle.env.sourceMap && map != null) {
              sourceMap = new SourceMap(options.projectRoot);
              sourceMap.addRawMappings(map.toJSON());
            }

            if (media.length) {
              content = `@media ${media.join(', ')} {\n${content}\n}\n`;
            }

            return [asset, content, sourceMap?.toBuffer()];
          } else {
            return Promise.all([
              asset,
              asset.getCode().then((css: string) => {
                if (media.length) {
                  return `@media ${media.join(', ')} {\n${css}\n}\n`;
                }

                return css;
              }),
              bundle.env.sourceMap && asset.getMapBuffer(),
            ]);
          }
        });
      },
    });

    let outputs = await queue.run();
    let contents = '';
    let map = new SourceMap(options.projectRoot);
    let lineOffset = 0;
    for (let [asset, code, mapBuffer] of outputs) {
      contents += code + '\n';
      if (bundle.env.sourceMap) {
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

    if (bundle.env.sourceMap) {
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
}): Packager);
