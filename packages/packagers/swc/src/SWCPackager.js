// @flow

import type {Asset, BundleGraph, NamedBundle, Async} from '@parcel/types';

import {Packager} from '@parcel/plugin';
import {
  PromiseQueue,
  relativeUrl,
  relativePath,
  relativeBundlePath,
  countLines,
} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import nullthrows from 'nullthrows';

// https://262.ecma-international.org/6.0/#sec-names-and-keywords
const IDENTIFIER_RE = /^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u;

const prelude = parcelRequireName => `var $parcel$modules = {};
var $parcel$inits = {};

var parcelRequire = globalThis[${JSON.stringify(parcelRequireName)}];
if (parcelRequire == null) {
  parcelRequire = function(id) {
    if (id in $parcel$modules) {
      return $parcel$modules[id].exports;
    }
    if (id in $parcel$inits) {
      let init = $parcel$inits[id];
      delete $parcel$inits[id];
      let module = {id, exports: {}};
      $parcel$modules[id] = module;
      init.call(module.exports, module, module.exports);
      return module.exports;
    }
    var err = new Error("Cannot find module '" + id + "'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  };

  parcelRequire.register = function register(id, init) {
    $parcel$inits[id] = init;
  };

  globalThis[${JSON.stringify(parcelRequireName)}] = parcelRequire;
}
`;

const helpers = {
  $parcel$export: `function $parcel$export(e, n, v, s) {
  Object.defineProperty(e, n, {get: v, set: s, enumerable: true});
}
`,
  $parcel$exportWildcard: `function $parcel$exportWildcard(dest, source) {
  Object.keys(source).forEach(function(key) {
    if (key === 'default' || key === '__esModule') {
      return;
    }

    Object.defineProperty(dest, key, {
      enumerable: true,
      get: function get() {
        return source[key];
      },
    });
  });

  return dest;
}
`,
  $parcel$interopDefault: `function $parcel$interopDefault(a) {
  return a && a.__esModule ? a.default : a;
}
`,
  $parcel$global: `var $parcel$global =
typeof globalThis !== 'undefined'
  ? globalThis
  : typeof self !== 'undefined'
  ? self
  : typeof window !== 'undefined'
  ? window
  : typeof global !== 'undefined'
  ? global
  : {};
`,
  $parcel$defineInteropFlag: `function $parcel$defineInteropFlag(a) {
  Object.defineProperty(a, '__esModule', {value: true});
}
`,
};

export default (new Packager({
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    config,
    options,
  }) {
    let isAsyncBundle = !isEntry(bundle, bundleGraph);
    let queue = new PromiseQueue({maxConcurrent: 32});
    let wrappedAssets = new Set();
    bundle.traverse((node, shouldWrap) => {
      switch (node.type) {
        case 'dependency':
          // Mark assets that should be wrapped, based on metadata in the incoming dependency tree
          if (shouldWrap || node.value.meta.shouldWrap) {
            let resolved = bundleGraph.getDependencyResolution(
              node.value,
              bundle,
            );
            if (resolved && resolved.sideEffects) {
              wrappedAssets.add(resolved.id);
            }
            return true;
          }
          break;
        case 'asset':
          queue.add(async () => {
            let [code, map] = await Promise.all([
              node.value.getCode(),
              node.value.getMapBuffer()
            ]);
            return [node.value.id, {asset: node.value, code, map}];
          });
          if (
            node.value.meta.shouldWrap ||
            isAsyncBundle ||
            bundleGraph.isAssetReferencedByDependant(bundle, node.value)
          ) {
            wrappedAssets.add(node.value.id);
            return true;
          }
      }
    });

    let outputs = new Map<string, {|asset: Asset, code: string, map: ?Buffer|}>(
      await queue.run(),
    );

    let needsPrelude = false;
    let usedHelpers = new Set();
    let interopDefaults = new Set();
    let seen = new Set();
    let visit = id => {
      if (seen.has(id)) {
        return ['', new SourceMap(options.projectRoot), 0];
      }

      seen.add(id);

      let {asset, code, map} = nullthrows(outputs.get(id));
      let shouldWrap = wrappedAssets.has(id);
      let deps = bundleGraph.getDependencies(asset);

      let sourceMap = bundle.env.sourceMap ? new SourceMap(options.projectRoot) : null;
      sourceMap?.addBufferMappings(nullthrows(map));

      if (shouldSkipAsset(bundleGraph, bundle, asset)) {
        let depCode = '';
        let lineCount = 0;
        // TODO: order?
        for (let dep of deps) {
          let resolved = bundleGraph.getDependencyResolution(dep, bundle);
          let skipped = bundleGraph.isDependencySkipped(dep);
          if (!resolved || skipped) continue;
          if (bundle.hasAsset(resolved)) {
            let [code, map, lines] = visit(resolved.id);
            depCode += code + '\n';
            if (sourceMap && map) {
              sourceMap.addBufferMappings(map.toBuffer(), lineCount);
            }
            lineCount += lines + 1;
          }
        }

        return [depCode, sourceMap, lineCount];
      }

      // TODO: maybe a meta prop?
      if (code.includes('$parcel$global')) {
        usedHelpers.add('$parcel$global');
      }

      let usedSymbols = bundleGraph.getUsedSymbols(asset);
      let hoistedRequires = new Map();

      let resolveSymbol = (resolved, imported, dep) => {
        let {
          asset: resolvedAsset,
          exportSymbol,
          symbol,
        } = bundleGraph.resolveSymbol(resolved, imported, bundle);
        let isWrapped =
          !bundle.hasAsset(resolvedAsset) ||
          (wrappedAssets.has(resolvedAsset.id) && resolvedAsset !== asset);
        let staticExports = resolvedAsset.meta.staticExports !== false;
        if (isWrapped && dep && !dep?.meta.shouldWrap) {
          let hoisted = hoistedRequires.get(dep.id);
          if (!hoisted) {
            hoisted = new Map();
            hoistedRequires.set(dep.id, hoisted);
          }

          hoisted.set(
            resolvedAsset.id,
            `var $${bundleGraph.getAssetPublicId(
              resolvedAsset,
            )} = parcelRequire(${JSON.stringify(
              bundleGraph.getAssetPublicId(resolvedAsset),
            )});`,
          );
        }

        if (isWrapped) {
          needsPrelude = true;
        }

        let isDefaultInterop =
          exportSymbol === 'default' &&
          dep?.meta.kind === 'Import' &&
          resolvedAsset.symbols.hasExportSymbol('*') &&
          resolvedAsset.symbols.hasExportSymbol('default') &&
          !resolvedAsset.symbols.hasExportSymbol('__esModule');

        let obj =
          isWrapped && (!dep || dep?.meta.shouldWrap)
            ? `parcelRequire(${JSON.stringify(
                bundleGraph.getAssetPublicId(resolvedAsset),
              )})`
            : isWrapped && dep
            ? `$${bundleGraph.getAssetPublicId(resolvedAsset)}`
            : resolvedAsset.symbols.get('*')?.local ||
              `$${resolvedAsset.meta.id}$exports`;
        if (imported === '*' || exportSymbol === '*' || isDefaultInterop) {
          return obj;
        } else if (
          (!staticExports || isWrapped || !symbol) &&
          resolvedAsset !== asset
        ) {
          if (
            exportSymbol === 'default' &&
            resolvedAsset.symbols.hasExportSymbol('*') &&
            needsDefaultInterop(bundleGraph, bundle, resolvedAsset)
          ) {
            usedHelpers.add('$parcel$interopDefault');
            return `$parcel$interopDefault(${obj})`;
          } else {
            if (IDENTIFIER_RE.test(exportSymbol)) {
              return `${obj}.${exportSymbol}`;
            }

            return `${obj}[${JSON.stringify(exportSymbol)}]`;
          }
        } else {
          return symbol;
        }
      };

      let replacements = new Map();
      for (let dep of deps) {
        let asyncResolution = bundleGraph.resolveAsyncDependency(dep, bundle);
        let resolved =
          asyncResolution?.type === 'asset'
            ? // Prefer the underlying asset over a runtime to load it. It will
              // be wrapped in Promise.resolve() later.
              asyncResolution.value
            : bundleGraph.getDependencyResolution(dep, bundle);
        if (!resolved || resolved === asset) continue;

        for (let [imported, {local}] of dep.symbols) {
          if (local === '*') continue;
          let symbol = resolveSymbol(resolved, imported, dep);
          replacements.set(
            local,
            asyncResolution?.type === 'asset'
              ? `Promise.resolve(${symbol})`
              : symbol,
          );
        }

        if (dep.isAsync && dep.meta.promiseSymbol) {
          let symbol = resolveSymbol(resolved, '*', dep);
          replacements.set(
            dep.meta.promiseSymbol,
            asyncResolution?.type === 'asset'
              ? `Promise.resolve(${symbol})`
              : symbol,
          );
        }
      }

      if (replacements.size > 0) {
        [code] = replace(code, sourceMap, replacements);
      }

      let defaultInterop =
        asset.symbols.hasExportSymbol('*') &&
        usedSymbols.has('default') &&
        !asset.symbols.hasExportSymbol('__esModule');

      if (
        asset.meta.staticExports === false ||
        shouldWrap ||
        usedSymbols.has('*') ||
        defaultInterop
      ) {
        let keys =
          usedSymbols.has('*') || asset.symbols.hasExportSymbol('*')
            ? asset.symbols.exportSymbols()
            : [...usedSymbols];
        let prepend = '';
        let prependLineCount = 0;
        if (!shouldWrap) {
          prepend += `var $${asset.meta.id}$exports = {};\n`;
          prependLineCount++;
        }

        // TODO: only if required by CJS?
        if (asset.symbols.hasExportSymbol('default') && usedSymbols.has('*')) {
          prepend += `\n$parcel$defineInteropFlag($${asset.meta.id}$exports);\n`;
          prependLineCount += 2;
          usedHelpers.add('$parcel$defineInteropFlag');
        }

        let incomingDeps = bundleGraph.getIncomingDependencies(asset);
        let usedExports = [...asset.symbols.exportSymbols()].filter(symbol => {
          if (symbol === '*') return false;
          if (defaultInterop) return true;
          let unused = incomingDeps.every(d => {
            let symbols = bundleGraph.getUsedSymbols(d);
            return !symbols.has(symbol) && !symbols.has('*');
          });
          return !unused;
        });

        if (usedExports.length > 0) {
          prepend += `\n${usedExports
            .map(
              exp =>
                `$parcel$export($${id}$exports, ${JSON.stringify(
                  exp,
                )}, () => ${resolveSymbol(asset, exp)}, (v) => ${resolveSymbol(
                  asset,
                  exp,
                )} = v);`,
            )
            .join('\n')}\n`;
          usedHelpers.add('$parcel$export');
          prependLineCount += 1 + usedExports.length;
        }

        for (let dep of deps) {
          let resolved = bundleGraph.getDependencyResolution(dep, bundle);
          if (!resolved || bundleGraph.isDependencySkipped(dep)) continue;

          let isWrapped = wrappedAssets.has(resolved.id);

          for (let [imported, {local}] of dep.symbols) {
            if (imported === '*' && local === '*') {
              if (
                isWrapped ||
                resolved.meta.staticExports === false ||
                bundleGraph.getUsedSymbols(resolved).has('*')
              ) {
                let obj = resolveSymbol(resolved, '*', dep);
                code += `\n$parcel$exportWildcard($${id}$exports, ${obj});`;
                usedHelpers.add('$parcel$exportWildcard');
              } else {
                for (let symbol of bundleGraph.getUsedSymbols(dep)) {
                  prepend += `$parcel$export($${id}$exports, ${JSON.stringify(
                    symbol,
                  )}, () => ${resolveSymbol(
                    resolved,
                    symbol,
                  )}, (v) => ${resolveSymbol(asset, symbol)} = v);\n`;
                  prependLineCount++;
                }
              }
            }
          }
        }

        if (sourceMap) {
          sourceMap.offsetLines(1, prependLineCount);
        }

        code = prepend + code;
      }

      let getHoistedParcelRequires = (dep, resolved) => {
        let hoisted = hoistedRequires.get(dep.id);
        let res = '';
        let lineCount = 0;
        let isWrapped =
          !bundle.hasAsset(resolved) ||
          (wrappedAssets.has(resolved.id) && resolved !== asset);

        if (
          isWrapped &&
          !dep.meta.shouldWrap &&
          (!hoisted || hoisted.keys().next().value !== resolved.id) &&
          !bundleGraph.isDependencySkipped(dep) &&
          !shouldSkipAsset(bundleGraph, bundle, resolved)
        ) {
          needsPrelude = true;
          res += `parcelRequire(${JSON.stringify(
            bundleGraph.getAssetPublicId(resolved),
          )});`;
        }

        if (hoisted) {
          needsPrelude = true;
          res += '\n' + [...hoisted.values()].join('\n');
          lineCount += hoisted.size;
        }

        return [res, lineCount];
      };

      let depMap = new Map();
      for (let dep of deps) {
        depMap.set(`${asset.meta.id}:${dep.moduleSpecifier}`, dep);
      }

      let lineCount = 0;
      if (shouldWrap) {
        needsPrelude = true;

        let depContent = [];
        let lineOffset = 1;
        code = code.replace(/\n|import\s+"(.+?)";/g, (m, d) => {
          if (m === '\n') {
            lineOffset++;
            lineCount++;
            return m;
          }

          let dep = depMap.get(d);
          if (dep) {
            let resolved = bundleGraph.getDependencyResolution(dep, bundle);
            let skipped = bundleGraph.isDependencySkipped(dep);
            if (resolved && !skipped && bundle.hasAsset(resolved)) {
              depContent.push(visit(resolved.id));
            }

            if (!resolved) {
              // TODO: handle sourcemap
              return '';
            }

            let [res, lines] = getHoistedParcelRequires(dep, resolved);
            if (sourceMap) {
              if (lines > 0) {
                sourceMap.offsetLines(lineOffset, lines);
              }
            }
            lineOffset += lines;
            lineCount += lines;
            return res;
          }
          return '';
        });

        let replacements = new Map();
        let exportsName =
          asset.symbols.get('*')?.local || `$${asset.id}$exports`;
        replacements.set(exportsName, 'module.exports');
        let lineDiff = 0;
        [code, lineDiff] = replace(code, sourceMap, replacements);
        lineCount += lineDiff;
        
        let depCode = '';
        let depLine = 1;
        for (let [code, map, lineCount] of depContent) {
          if (!code) continue;
          depCode += code + '\n';
          lineCount++;
          if (sourceMap && map) {
            sourceMap.offsetLines(depLine, lineCount);
            sourceMap.addBufferMappings(map.toBuffer(), depLine - 1, 0);
            depLine += lineCount;
          }
        }

        sourceMap?.offsetLines(depLine, 1);
        lineCount += depLine ;

        code = depCode + `parcelRequire.register(${JSON.stringify(
          bundleGraph.getAssetPublicId(asset),
        )}, function(module, exports) {
${code}
});
`;

        lineCount += 2;
      } else {
        let lineOffset = 1;
        code = code.replace(/\n|import\s+"(.+?)";/g, (m, d) => {
          if (m === '\n') {
            lineOffset++;
            lineCount++;
            return m;
          }

          let dep = nullthrows(depMap.get(d));
          let resolved = bundleGraph.getDependencyResolution(dep, bundle);
          let skipped = bundleGraph.isDependencySkipped(dep);
          if (resolved && !skipped) {
            if (bundle.hasAsset(resolved)) {
              let [res, map, lines] = visit(resolved.id);
              let [hoisted, hoistedLineCount] = getHoistedParcelRequires(dep, resolved);
              if (hoisted) {
                res += '\n' + hoisted;
                lines += 1 + hoistedLineCount;
              }
              if (sourceMap && map) {
                if (lines > 0) {
                  sourceMap.offsetLines(lineOffset, lines);
                }
                sourceMap.addBufferMappings(map.toBuffer(), lineOffset - 1, 0);
                lineOffset += lines;
              }
              lineCount += lines;
              return res;
            } else if (resolved.type === 'js') {
              let [hoisted, hoistedLineCount] = getHoistedParcelRequires(dep, resolved);
              // TODO
              return hoisted;
            }
          }
          return '';
        });
      }

      return [code, sourceMap, lineCount];
    };

    let res = '';
    let lineCount = 0;
    let sourceMap = bundle.env.sourceMap ? new SourceMap(options.projectRoot) : null;
    bundle.traverseAssets((asset, _, actions) => {
      if (seen.has(asset.id)) {
        actions.skipChildren();
        return
      }

      let [content, map, lines] = visit(asset.id);
      res += content + '\n';
      if (sourceMap && map) {
        sourceMap.addBufferMappings(map.toBuffer(), lineCount);
      }
      lineCount += lines + 1;
      actions.skipChildren();
    });

    for (let helper of usedHelpers) {
      res = helpers[helper] + res;
      if (sourceMap) {
        sourceMap.offsetLines(1, countLines(helpers[helper]) - 1);
      }
    }

    if (needsPrelude) {
      let parentBundles = bundleGraph.getParentBundles(bundle);
      let mightBeFirstJS =
        parentBundles.length === 0 ||
        parentBundles.some(b => b.type !== 'js') ||
        bundleGraph
          .getBundleGroupsContainingBundle(bundle)
          .some(g => bundleGraph.isEntryBundleGroup(g)) ||
        bundle.env.isIsolated() ||
        !!bundle.getMainEntry()?.isIsolated;
      if (mightBeFirstJS) {
        let preludeContent = prelude('parcelRequire123');
        if (sourceMap) {
          sourceMap.offsetLines(1, countLines(preludeContent) - 1);
        }
        res = preludeContent + res;
      } else {
        res =
          `var parcelRequire = globalThis[${JSON.stringify(
            'parcelRequire123',
          )}];\n` + res;
        sourceMap?.offsetLines(1, 1);
      }
    }

    let entries = bundle.getEntryAssets();
    let mainEntry = bundle.getMainEntry();
    if (isAsyncBundle && bundle.env.outputFormat === 'global') {
      // In async bundles we don't want the main entry to execute until we require it
      // as there might be dependencies in a sibling bundle that hasn't loaded yet.
      entries = entries.filter(a => a.id !== mainEntry?.id);
      mainEntry = null;
    }

    for (let entry of entries) {
      if (wrappedAssets.has(entry.id)) {
        res += `\nparcelRequire(${JSON.stringify(
          bundleGraph.getAssetPublicId(entry),
        )});\n`;
      }
    }

    if (bundle.env.isWorker()) {
      let importScripts = '';
      let bundles = bundleGraph.getReferencedBundles(bundle);
      for (let b of bundles) {
        importScripts += `importScripts("${relativeBundlePath(bundle, b)}");\n`;
      }

      res = importScripts + res;
      sourceMap?.offsetLines(1, bundles.length);
    }

    sourceMap?.offsetLines(1, 1);
    res = `(function () {
${res}
})();`;

    // console.log(bundle.name, res)

    return {
      contents: res,
      map: sourceMap
    };
  },
}): Packager);

function needsDefaultInterop(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: NamedBundle,
  asset: Asset,
): boolean {
  if (
    asset.symbols.hasExportSymbol('*') &&
    !asset.symbols.hasExportSymbol('default')
  ) {
    let deps = bundleGraph.getIncomingDependencies(asset);
    return deps.some(
      dep =>
        bundle.hasDependency(dep) &&
        // dep.meta.isES6Module &&
        dep.symbols.hasExportSymbol('default'),
    );
  }

  return false;
}

function shouldSkipAsset(
  bundleGraph: BundleGraph<NamedBundle>,
  bundle: NamedBundle,
  asset: Asset,
) {
  return (
    asset.sideEffects === false &&
    bundleGraph.getUsedSymbols(asset).size == 0 &&
    !bundleGraph.isAssetReferencedByDependant(bundle, asset)
  );
}

function isEntry(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): boolean {
  // If there is no parent JS bundle (e.g. in an HTML page), or environment is isolated (e.g. worker)
  // then this bundle is an "entry"
  return (
    !bundleGraph.hasParentBundleOfType(bundle, 'js') ||
    bundle.env.isIsolated() ||
    !!bundle.getMainEntry()?.isIsolated
  );
}

function replace(code: string, sourceMap: ?SourceMap, replacements: Map<string, string>) {
  let regex = new RegExp(
    '\n|' +
    [...replacements.keys()]
      .sort((a, b) => b.length - a.length)
      .map(k => k.replace(/[$]/g, '\\$&'))
      .join('|'),
    'g',
  );
  let line = 1;
  let offset = 0;
  let columnStartIndex = 0;
  let lineDiff = 0;
  code = code.replace(regex, (m, i) => {
    if (m === '\n') {
      line++;
      columnStartIndex = i + offset + 1;
      return '\n';
    }

    let replacement = replacements.get(m);
    if (sourceMap) {
      // let matchNewlineIndex = newlineIndex(m);
      // let replacementNewlineIndex = newlineIndex(replacement);
      // let lengthDifference = replacementNewlineIndex - matchNewlineIndex;
      let lengthDifference = replacement.length - m.length;
      if (lengthDifference !== 0) {
        sourceMap.offsetColumns(line, i + offset - columnStartIndex + m.length, lengthDifference);
        offset += lengthDifference;
      }

      // let matchLines = countLines(m, matchNewlineIndex);
      // let replacementLines = countLines(replacement, replacementNewlineIndex);
      // let lineDifference = replacementLines - matchLines;
      // if (lineDifference !== 0) {
      //   sourceMap.offsetLines(line + 1, lineDifference);
      //   lineDiff += lineDifference;
      //   offset = 0;
      // }
    }
    return replacement;
  });

  return [code, lineDiff];
}

function newlineIndex(s) {
  let idx = s.indexOf('\n');
  return idx < 0 ? s.length : idx;
}
