// @flow strict-local

import SourceMap from '@parcel/source-map';
import {Optimizer} from '@parcel/plugin';
import {
  transform,
  transformStyleAttribute,
  browserslistToTargets,
} from '@parcel/css';
import {blobToBuffer} from '@parcel/utils';
import browserslist from 'browserslist';
import nullthrows from 'nullthrows';

export default (new Optimizer({
  async optimize({
    bundle,
    bundleGraph,
    logger,
    contents: prevContents,
    getSourceMapReference,
    map: prevMap,
    options,
  }) {
    if (!bundle.env.shouldOptimize) {
      return {contents: prevContents, map: prevMap};
    }

    let targets = getTargets(bundle.env.engines.browsers);
    let code = await blobToBuffer(prevContents);

    let unusedSymbols;
    if (bundle.env.shouldScopeHoist) {
      unusedSymbols = [];
      bundle.traverseAssets(asset => {
        if (asset.symbols.isCleared) {
          return;
        }

        let usedSymbols = bundleGraph.getUsedSymbols(asset);
        if (usedSymbols == null) {
          return;
        }

        let defaultImport = null;
        if (usedSymbols.has('default')) {
          let incoming = bundleGraph.getIncomingDependencies(asset);
          defaultImport = incoming.find(d =>
            d.symbols.hasExportSymbol('default'),
          );
          if (defaultImport) {
            let loc = defaultImport.symbols.get('default')?.loc;
            logger.warn({
              message:
                'CSS modules cannot be tree shaken when imported with a default specifier',
              ...(loc && {
                codeFrames: [
                  {
                    filePath: nullthrows(
                      loc?.filePath ?? defaultImport.sourcePath,
                    ),
                    codeHighlights: [{start: loc.start, end: loc.end}],
                  },
                ],
              }),
              hints: [
                `Instead do: import * as style from "${defaultImport.specifier}";`,
              ],
              documentationURL:
                'https://parceljs.org/languages/css/#tree-shaking',
            });
          }
        }

        if (!defaultImport && !usedSymbols.has('*')) {
          for (let [symbol, {local}] of asset.symbols) {
            if (local !== 'default' && !usedSymbols.has(symbol)) {
              unusedSymbols.push(local);
            }
          }
        }
      });
    }

    // Inline style attributes in HTML need to be parsed differently from full CSS files.
    if (bundle.bundleBehavior === 'inline') {
      let entry = bundle.getMainEntry();
      if (entry?.meta.type === 'attr') {
        let result = transformStyleAttribute({
          code,
          minify: true,
          targets,
        });

        return {
          contents: result.code,
        };
      }
    }

    let result = transform({
      filename: bundle.name,
      code,
      minify: true,
      sourceMap: !!bundle.env.sourceMap,
      targets,
      unusedSymbols,
    });

    let map;
    if (result.map != null) {
      let vlqMap = JSON.parse(result.map.toString());
      map = new SourceMap(options.projectRoot);
      map.addVLQMap(vlqMap);
      if (prevMap) {
        map.extends(prevMap);
      }
    }

    let contents = result.code;
    if (bundle.env.sourceMap) {
      let reference = await getSourceMapReference(map);
      if (reference != null) {
        contents =
          contents.toString() +
          '\n' +
          '/*# sourceMappingURL=' +
          reference +
          ' */\n';
      }
    }

    return {
      contents,
      map,
    };
  },
}): Optimizer);

let cache = new Map();

function getTargets(browsers) {
  if (browsers == null) {
    return undefined;
  }

  let cached = cache.get(browsers);
  if (cached != null) {
    return cached;
  }

  let targets = browserslistToTargets(browserslist(browsers));

  cache.set(browsers, targets);
  return targets;
}
