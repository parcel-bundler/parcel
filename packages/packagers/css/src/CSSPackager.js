// @flow

import type {Root} from 'postcss';
import type {Asset, Dependency} from '@parcel/types';
import typeof PostCSS from 'postcss';
// $FlowFixMe - init for browser build.
import init, {bundleAsync} from 'lightningcss';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import SourceMap from '@parcel/source-map';
import {Packager} from '@parcel/plugin';
import {convertSourceLocationToHighlight} from '@parcel/diagnostic';
import {
  PromiseQueue,
  replaceInlineReferences,
  replaceURLReferences,
} from '@parcel/utils';

export default (new Packager({
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    logger,
    options,
  }) {
    // Inline style attributes are parsed differently from full CSS files.
    if (bundle.bundleBehavior === 'inline') {
      let entry = bundle.getMainEntry();
      if (entry?.meta.type === 'attr') {
        return replaceReferences(
          bundle,
          bundleGraph,
          await entry.getCode(),
          await entry.getMap(),
          getInlineBundleContents,
        );
      }
    }

    let queue = new PromiseQueue({
      maxConcurrent: 32,
    });
    let hoistedImports = [];
    let assetsByPlaceholder = new Map();
    let entry = null;
    let entryContents = '';

    bundle.traverse({
      enter: (node, context) => {
        if (node.type === 'asset' && !context) {
          // If there is only one entry, we'll use it directly.
          // Otherwise, we'll create a fake bundle entry with @import rules for each root asset.
          if (entry == null) {
            entry = node.value.id;
          } else {
            entry = bundle.id;
          }

          assetsByPlaceholder.set(node.value.id, node.value);
          entryContents += `@import "${node.value.id}";\n`;
        }
        return true;
      },
      exit: node => {
        if (node.type === 'dependency') {
          let resolved = bundleGraph.getResolvedAsset(node.value, bundle);

          // Hoist unresolved external dependencies (i.e. http: imports)
          if (
            node.value.priority === 'sync' &&
            !bundleGraph.isDependencySkipped(node.value) &&
            !resolved
          ) {
            hoistedImports.push(node.value.specifier);
          }

          if (resolved && bundle.hasAsset(resolved)) {
            assetsByPlaceholder.set(
              node.value.meta.placeholder ?? node.value.specifier,
              resolved,
            );
          }

          return;
        }

        let asset = node.value;
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

                return css;
              }),
              bundle.env.sourceMap ? asset.getMap() : null,
            ]);
          }
        });
      },
    });

    let outputs = new Map(
      (await queue.run()).map(([asset, code, map]) => [asset, [code, map]]),
    );
    let map = new SourceMap(options.projectRoot);

    // $FlowFixMe
    if (process.browser) {
      await init();
    }

    let res = await bundleAsync({
      filename: nullthrows(entry),
      sourceMap: !!bundle.env.sourceMap,
      resolver: {
        resolve(specifier) {
          return specifier;
        },
        async read(file) {
          if (file === bundle.id) {
            return entryContents;
          }

          let asset = assetsByPlaceholder.get(file);
          if (!asset) {
            return '';
          }
          let [code, map] = nullthrows(outputs.get(asset));
          if (map) {
            let sm = await map.stringify({format: 'inline'});
            invariant(typeof sm === 'string');
            code += `\n/*# sourceMappingURL=${sm} */`;
          }
          return code;
        },
      },
    });

    let contents = res.code.toString();

    if (res.map) {
      let vlqMap = JSON.parse(res.map.toString());
      map.addVLQMap(vlqMap);
      let reference = await getSourceMapReference(map);
      if (reference != null) {
        contents += '/*# sourceMappingURL=' + reference + ' */\n';
      }
    }

    // Prepend hoisted external imports.
    if (hoistedImports.length > 0) {
      let lineOffset = 0;
      let hoistedCode = '';
      for (let url of hoistedImports) {
        hoistedCode += `@import "${url}";\n`;
        lineOffset++;
      }

      if (bundle.env.sourceMap) {
        map.offsetLines(1, lineOffset);
      }

      contents = hoistedCode + contents;
    }

    return replaceReferences(
      bundle,
      bundleGraph,
      contents,
      map,
      getInlineBundleContents,
    );
  },
}): Packager);

function replaceReferences(
  bundle,
  bundleGraph,
  contents,
  map,
  getInlineBundleContents,
) {
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
}

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
): Promise<[Asset, string, ?SourceMap]> {
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

  return [asset, content, sourceMap];
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
