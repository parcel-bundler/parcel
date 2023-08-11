// @flow

import type {Root} from 'postcss';
import type {Asset, Dependency} from '@parcel/types';
import typeof PostCSS from 'postcss';

import path from 'path';
import SourceMap from '@parcel/source-map';
import {Packager} from '@parcel/plugin';
import {convertSourceLocationToHighlight} from '@parcel/diagnostic';
import {
  PromiseQueue,
  countLines,
  replaceInlineReferences,
  replaceURLReferences,
} from '@parcel/utils';

import nullthrows from 'nullthrows';

export default (new Packager({
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    logger,
    options,
  }) {
    let queue = new PromiseQueue({
      maxConcurrent: 32,
    });
    let hoistedImports = [];
    bundle.traverse({
      exit: node => {
        if (node.type === 'dependency') {
          // Hoist unresolved external dependencies (i.e. http: imports)
          if (
            node.value.priority === 'sync' &&
            !bundleGraph.isDependencySkipped(node.value) &&
            !bundleGraph.getResolvedAsset(node.value, bundle)
          ) {
            hoistedImports.push(node.value.specifier);
          }
          return;
        }

        let asset = node.value;

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

        queue.add(() => {
          if (
            !asset.symbols.isCleared &&
            options.mode === 'production' &&
            asset.astGenerator?.type === 'postcss'
          ) {
            // a CSS Modules asset
            return processCSSModule(
              options,
              logger,
              bundleGraph,
              bundle,
              asset,
              media,
            );
          } else {
            return Promise.all([
              asset,
              asset.getCode().then((css: string) => {
                // Replace CSS variable references with resolved symbols.
                if (asset.meta.hasReferences) {
                  let replacements = new Map();
                  for (let dep of asset.getDependencies()) {
                    for (let [exported, {local}] of dep.symbols) {
                      let resolved = bundleGraph.getResolvedAsset(dep, bundle);
                      if (resolved) {
                        let resolution = bundleGraph.getSymbolResolution(
                          resolved,
                          exported,
                          bundle,
                        );
                        if (resolution.symbol) {
                          replacements.set(local, resolution.symbol);
                        }
                      }
                    }
                  }
                  if (replacements.size > 0) {
                    let regex = new RegExp(
                      [...replacements.keys()].join('|'),
                      'g',
                    );
                    css = css.replace(regex, m =>
                      escapeDashedIdent(replacements.get(m) || m),
                    );
                  }
                }

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

    for (let url of hoistedImports) {
      contents += `@import "${url}";\n`;
      lineOffset++;
    }

    for (let [asset, code, mapBuffer] of outputs) {
      contents += code + '\n';
      if (bundle.env.sourceMap) {
        if (mapBuffer) {
          map.addBuffer(mapBuffer, lineOffset);
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
      getReplacement: escapeString,
    }));

    return replaceInlineReferences({
      bundle,
      bundleGraph,
      contents,
      getInlineBundleContents,
      getInlineReplacement: (dep, inlineType, contents) => ({
        from: getSpecifier(dep),
        to: escapeString(contents),
      }),
      map,
    });
  },
}): Packager);

export function getSpecifier(dep: Dependency): string {
  if (typeof dep.meta.placeholder === 'string') {
    return dep.meta.placeholder;
  }

  return dep.id;
}

function escapeString(contents: string): string {
  return contents.replace(/(["\\])/g, '\\$1');
}

async function processCSSModule(
  options,
  logger,
  bundleGraph,
  bundle,
  asset,
  media,
): Promise<[Asset, string, ?Buffer]> {
  let postcss: PostCSS = await options.packageManager.require(
    'postcss',
    options.projectRoot + '/index',
    {
      range: '^8.4.5',
      saveDev: true,
      shouldAutoInstall: options.shouldAutoInstall,
    },
  );

  let ast: Root = postcss.fromJSON(nullthrows((await asset.getAST())?.program));

  let usedSymbols = bundleGraph.getUsedSymbols(asset);
  if (usedSymbols != null) {
    let localSymbols = new Set(
      [...asset.symbols].map(([, {local}]) => `.${local}`),
    );

    let defaultImport = null;
    if (usedSymbols.has('default')) {
      let incoming = bundleGraph.getIncomingDependencies(asset);
      defaultImport = incoming.find(d => d.symbols.hasExportSymbol('default'));
      if (defaultImport) {
        let loc = defaultImport.symbols.get('default')?.loc;
        logger.warn({
          message:
            'CSS modules cannot be tree shaken when imported with a default specifier',
          ...(loc && {
            codeFrames: [
              {
                filePath: nullthrows(loc?.filePath ?? defaultImport.sourcePath),
                codeHighlights: [convertSourceLocationToHighlight(loc)],
              },
            ],
          }),
          hints: [
            `Instead do: import * as style from "${defaultImport.specifier}";`,
          ],
          documentationURL: 'https://parceljs.org/languages/css/#tree-shaking',
        });
      }
    }

    if (!defaultImport && !usedSymbols.has('*')) {
      let usedLocalSymbols = new Set(
        [...usedSymbols].map(
          exportSymbol =>
            `.${nullthrows(asset.symbols.get(exportSymbol)).local}`,
        ),
      );
      ast.walkRules(rule => {
        if (
          localSymbols.has(rule.selector) &&
          !usedLocalSymbols.has(rule.selector)
        ) {
          rule.remove();
        }
      });
    }
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
    sourceMap.addVLQMap(map.toJSON());
  }

  if (media.length) {
    content = `@media ${media.join(', ')} {\n${content}\n}\n`;
  }

  return [asset, content, sourceMap?.toBuffer()];
}

function escapeDashedIdent(name) {
  // https://drafts.csswg.org/cssom/#serialize-an-identifier
  let res = '';
  for (let c of name) {
    let code = c.codePointAt(0);
    if (code === 0) {
      res += '\ufffd';
    } else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f) {
      res += '\\' + code.toString(16) + ' ';
    } else if (
      (code >= 48 /* '0' */ && code <= 57) /* '9' */ ||
      (code >= 65 /* 'A' */ && code <= 90) /* 'Z' */ ||
      (code >= 97 /* 'a' */ && code <= 122) /* 'z' */ ||
      code === 95 /* '_' */ ||
      code === 45 /* '-' */ ||
      code & 128 // non-ascii
    ) {
      res += c;
    } else {
      res += '\\' + c;
    }
  }

  return res;
}
