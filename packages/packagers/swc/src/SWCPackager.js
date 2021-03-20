// @flow

import type {
  Asset,
  BundleGraph,
  Dependency,
  PluginOptions,
  NamedBundle,
  Async,
} from '@parcel/types';

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
import invariant from 'assert';

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
  package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    config,
    options,
  }) {
    return new SWCPackager(
      options,
      bundleGraph,
      bundle,
      'parcelRequire123',
    ).package();
  },
}): Packager);

class SWCPackager {
  options: PluginOptions;
  bundleGraph: BundleGraph<NamedBundle>;
  bundle: NamedBundle;
  parcelRequireName: string;
  isAsyncBundle: boolean;
  assetOutputs: Map<string, {|code: string, map: ?Buffer|}>;
  seenAssets: Set<string> = new Set();
  wrappedAssets: Set<string> = new Set();
  hoistedRequires: Map<string, Map<string, string>> = new Map();
  needsPrelude: boolean = false;
  usedHelpers: Set<string> = new Set();

  constructor(
    options: PluginOptions,
    bundleGraph: BundleGraph<NamedBundle>,
    bundle: NamedBundle,
    parcelRequireName: string,
  ) {
    this.options = options;
    this.bundleGraph = bundleGraph;
    this.bundle = bundle;
    this.parcelRequireName = parcelRequireName;
    this.isAsyncBundle =
      this.bundleGraph.hasParentBundleOfType(this.bundle, 'js') &&
      !this.bundle.env.isIsolated() &&
      !this.bundle.getMainEntry()?.isIsolated;
  }

  async package() {
    await this.loadAssets();

    // Add each asset that is directly connected to the bundle. Dependencies will be handled
    // by replacing `import` statements in the code.
    let res = '';
    let lineCount = 0;
    let sourceMap = this.bundle.env.sourceMap
      ? new SourceMap(this.options.projectRoot)
      : null;
    this.bundle.traverseAssets((asset, _, actions) => {
      if (this.seenAssets.has(asset.id)) {
        actions.skipChildren();
        return;
      }

      let [content, map, lines] = this.visitAsset(asset);
      if (sourceMap && map) {
        sourceMap.addSourceMap(map, lineCount);
      }

      res += content + '\n';
      lineCount += lines + 1;
      actions.skipChildren();
    });

    let [prelude, preludeLines] = this.buildBundlePrelude();
    res = prelude + res;
    sourceMap?.offsetLines(1, 1 + preludeLines);

    let entries = this.bundle.getEntryAssets();
    let mainEntry = this.bundle.getMainEntry();
    if (this.isAsyncBundle && this.bundle.env.outputFormat === 'global') {
      // In async bundles we don't want the main entry to execute until we require it
      // as there might be dependencies in a sibling bundle that hasn't loaded yet.
      entries = entries.filter(a => a.id !== mainEntry?.id);
      mainEntry = null;
    }

    // If any of the entry assets are wrapped, call parcelRequire so they are executed.
    for (let entry of entries) {
      if (this.wrappedAssets.has(entry.id)) {
        res += `\nparcelRequire(${JSON.stringify(
          this.bundleGraph.getAssetPublicId(entry),
        )});\n`;
      }
    }

    res = `(function () {
${res}
})();`;

    return {
      contents: res,
      map: sourceMap,
    };
  }

  async loadAssets() {
    let queue = new PromiseQueue({maxConcurrent: 32});
    this.bundle.traverse((node, shouldWrap) => {
      switch (node.type) {
        case 'dependency':
          // Mark assets that should be wrapped, based on metadata in the incoming dependency tree
          if (shouldWrap || node.value.meta.shouldWrap) {
            let resolved = this.bundleGraph.getDependencyResolution(
              node.value,
              this.bundle,
            );
            if (resolved && resolved.sideEffects) {
              this.wrappedAssets.add(resolved.id);
            }
            return true;
          }
          break;
        case 'asset':
          queue.add(async () => {
            let [code, map] = await Promise.all([
              node.value.getCode(),
              this.bundle.env.sourceMap ? node.value.getMapBuffer() : null,
            ]);
            return [node.value.id, {code, map}];
          });

          if (
            node.value.meta.shouldWrap ||
            this.isAsyncBundle ||
            this.bundleGraph.isAssetReferencedByDependant(
              this.bundle,
              node.value,
            )
          ) {
            this.wrappedAssets.add(node.value.id);
            return true;
          }
      }
    });

    this.assetOutputs = new Map(await queue.run());
  }

  visitAsset(asset: Asset) {
    invariant(!this.seenAssets.has(asset.id), 'Already visited asset');
    this.seenAssets.add(asset.id);

    let {code, map} = nullthrows(this.assetOutputs.get(asset.id));
    return this.buildAsset(asset, code, map);
  }

  buildAsset(asset: Asset, code: string, map: ?Buffer) {
    let shouldWrap = this.wrappedAssets.has(asset.id);
    let deps = this.bundleGraph.getDependencies(asset);

    let sourceMap = this.bundle.env.sourceMap
      ? new SourceMap(this.options.projectRoot)
      : null;
    if (sourceMap && map) {
      sourceMap?.addBufferMappings(map);
    }

    if (this.shouldSkipAsset(asset)) {
      let depCode = '';
      let lineCount = 0;
      // TODO: order?
      for (let dep of deps) {
        let resolved = this.bundleGraph.getDependencyResolution(
          dep,
          this.bundle,
        );
        let skipped = this.bundleGraph.isDependencySkipped(dep);
        if (!resolved || skipped) {
          continue;
        }

        if (
          this.bundle.hasAsset(resolved) &&
          !this.seenAssets.has(resolved.id)
        ) {
          let [code, map, lines] = this.visitAsset(resolved);
          depCode += code + '\n';
          if (sourceMap && map) {
            sourceMap.addSourceMap(map, lineCount);
          }
          lineCount += lines + 1;
        }
      }

      return [depCode, sourceMap, lineCount];
    }

    // TODO: maybe a meta prop?
    if (code.includes('$parcel$global')) {
      this.usedHelpers.add('$parcel$global');
    }

    let [prepend, prependLines, append] = this.buildAssetPrelude(asset, deps);
    if (prependLines > 0) {
      sourceMap?.offsetLines(1, prependLines);
      code = prepend + code;
    }

    code += append;

    let [depMap, replacements] = this.buildReplacements(asset, deps);

    // Build a regular expression for all the replacements we need to do.
    // We need to track how many newlines there are for source maps, replace
    // all import statements with dependency code, and perform inline replacements
    // of all imported symbols with their resolved export symbols. This is all done
    // in a single regex so that we only do one pass over the whole code.
    let regex = new RegExp(
      '\n|import\\s+"(.+?)";' +
        (replacements.size > 0
          ? '|' +
            [...replacements.keys()]
              .sort((a, b) => b.length - a.length)
              .map(k => k.replace(/[$]/g, '\\$&'))
              .join('|')
          : ''),
      'g',
    );

    let lineCount = 0;
    let offset = 0;
    let columnStartIndex = 0;
    let depContent = [];
    code = code.replace(regex, (m, d, i) => {
      if (m === '\n') {
        columnStartIndex = i + offset + 1;
        lineCount++;
        return '\n';
      }

      // If we matched an import, replace with the source code for the dependency.
      if (d != null) {
        let dep = nullthrows(depMap.get(d));
        let resolved = this.bundleGraph.getDependencyResolution(
          dep,
          this.bundle,
        );
        let skipped = this.bundleGraph.isDependencySkipped(dep);
        if (resolved && !skipped) {
          // Hoist variable declarations for the referenced parcelRequire dependencies
          // after the dependency is declared. This handles the case where the resulting asset
          // is wrapped, but the dependency in this asset is not marked as wrapped. This means
          // that it was imported/required at the top-level, so its side effects should run immediately.
          let [res, lines] = this.getHoistedParcelRequires(
            asset,
            dep,
            resolved,
          );
          let map;
          if (
            this.bundle.hasAsset(resolved) &&
            !this.seenAssets.has(resolved.id)
          ) {
            // If this asset is wrapped, we need to hoist the code for the dependency
            // outside our parcelRequire.register wrapper. This is safe because all
            // assets referenced by this asset will also be wrapped. Otherwise, inline the
            // asset content where the import statement was.
            if (shouldWrap) {
              depContent.push(this.visitAsset(resolved));
            } else {
              let [depCode, depMap, depLines] = this.visitAsset(resolved);
              res = depCode + '\n' + res;
              lines += 1 + depLines;
              map = depMap;
            }
          }

          // Push this asset's source mappings down by the number of lines in the dependency
          // plus the number of hoisted parcelRequires. Then insert the source map for the dependency.
          if (sourceMap) {
            if (lines > 0) {
              sourceMap.offsetLines(lineCount + 1, lines);
            }

            if (map) {
              sourceMap.addSourceMap(map, lineCount, 0);
            }
          }

          lineCount += lines;
          return res;
        }

        return '';
      }

      // If it wasn't a dependency, then it was an inline replacement (e.g. $id$import$foo -> $id$export$foo).
      let replacement = replacements.get(m) ?? '';
      if (sourceMap) {
        // Offset the source map columns for this line if the replacement was a different length.
        // This assumes that the match and replacement both do not contain any newlines.
        let lengthDifference = replacement.length - m.length;
        if (lengthDifference !== 0) {
          sourceMap.offsetColumns(
            lineCount + 1,
            i + offset - columnStartIndex + m.length,
            lengthDifference,
          );
          offset += lengthDifference;
        }
      }
      return replacement;
    });

    // If the asset is wrapped, we need to insert the dependency code that we collected above
    // before the parcelRequire wrapper around this asset's code.
    if (shouldWrap) {
      if (sourceMap) {
        // Count the number of lines for each dependency, plus one for the newline after each,
        // (if it has any code), and one for parcelRequire.register at the end.
        // We do this rather than in the loop below so that offsetLines is only called once.
        let depLines = depContent.reduce(
          (p, d) => (p += d[2] > 0 ? d[2] + 1 : 0),
          1,
        );
        sourceMap.offsetLines(1, depLines);
        lineCount += depLines;
      }

      let depCode = '';
      let depLines = 0;
      for (let [code, map, lineCount] of depContent) {
        if (!code) continue;
        depCode += code + '\n';
        if (sourceMap && map) {
          sourceMap.addSourceMap(map, depLines, 0);
        }
        depLines += lineCount + 1;
      }

      code =
        depCode +
        `parcelRequire.register(${JSON.stringify(
          this.bundleGraph.getAssetPublicId(asset),
        )}, function(module, exports) {
${code}
});
`;

      lineCount += 2;
      this.needsPrelude = true;
    }

    return [code, sourceMap, lineCount];
  }

  buildReplacements(asset: Asset, deps: Array<Dependency>) {
    let assetId = asset.meta.id;
    invariant(typeof assetId === 'string');

    // Build two maps: one of import specifiers, and one of imported symbols to replace.
    // These will be used to build a regex below.
    let depMap = new Map();
    let replacements = new Map();
    for (let dep of deps) {
      depMap.set(`${assetId}:${dep.moduleSpecifier}`, dep);

      let asyncResolution = this.bundleGraph.resolveAsyncDependency(
        dep,
        this.bundle,
      );
      let resolved =
        asyncResolution?.type === 'asset'
          ? // Prefer the underlying asset over a runtime to load it. It will
            // be wrapped in Promise.resolve() later.
            asyncResolution.value
          : this.bundleGraph.getDependencyResolution(dep, this.bundle);
      if (!resolved || resolved === asset) {
        continue;
      }

      for (let [imported, {local}] of dep.symbols) {
        if (local === '*') {
          continue;
        }

        let symbol = this.resolveSymbol(asset, resolved, imported, dep);
        replacements.set(
          local,
          // If this was an internalized async asset, wrap in a Promise.resolve.
          asyncResolution?.type === 'asset'
            ? `Promise.resolve(${symbol})`
            : symbol,
        );
      }

      // Async dependencies need a namespace object even if all used symbols were statically analyzed.
      // This is recorded in the promiseSymbol meta property set by the transformer rather than in
      // symbols so that we don't mark all symbols as used.
      if (dep.isAsync && dep.meta.promiseSymbol) {
        let promiseSymbol = dep.meta.promiseSymbol;
        invariant(typeof promiseSymbol === 'string');
        let symbol = this.resolveSymbol(asset, resolved, '*', dep);
        replacements.set(
          promiseSymbol,
          asyncResolution?.type === 'asset'
            ? `Promise.resolve(${symbol})`
            : symbol,
        );
      }
    }

    // If this asset is wrapped, we need to replace the exports namespace with `module.exports`,
    // which will be provided to us by the wrapper.
    if (this.wrappedAssets.has(asset.id)) {
      let exportsName = asset.symbols.get('*')?.local || `$${asset.id}$exports`;
      replacements.set(exportsName, 'module.exports');
    }

    return [depMap, replacements];
  }

  resolveSymbol(
    parentAsset: Asset,
    resolved: Asset,
    imported: string,
    dep?: Dependency,
  ) {
    let {
      asset: resolvedAsset,
      exportSymbol,
      symbol,
    } = this.bundleGraph.resolveSymbol(resolved, imported, this.bundle);
    let isWrapped =
      !this.bundle.hasAsset(resolvedAsset) ||
      (this.wrappedAssets.has(resolvedAsset.id) &&
        resolvedAsset !== parentAsset);
    let staticExports = resolvedAsset.meta.staticExports !== false;
    let publicId = this.bundleGraph.getAssetPublicId(resolvedAsset);

    // If the rsolved asset is wrapped, but imported at the top-level by this asset,
    // then we hoist parcelRequire calls to the top of this asset so side effects run immediately.
    if (isWrapped && dep && !dep?.meta.shouldWrap) {
      let hoisted = this.hoistedRequires.get(dep.id);
      if (!hoisted) {
        hoisted = new Map();
        this.hoistedRequires.set(dep.id, hoisted);
      }

      hoisted.set(
        resolvedAsset.id,
        `var $${publicId} = parcelRequire(${JSON.stringify(publicId)});`,
      );
    }

    if (isWrapped) {
      this.needsPrelude = true;
    }

    // If this is an ESM default import of a CJS module with a `default` symbol,
    // and no __esModule flag, we need to resolve to the namespace instead.
    let isDefaultInterop =
      exportSymbol === 'default' &&
      dep?.meta.kind === 'Import' &&
      resolvedAsset.symbols.hasExportSymbol('*') &&
      resolvedAsset.symbols.hasExportSymbol('default') &&
      !resolvedAsset.symbols.hasExportSymbol('__esModule');

    // Find the namespace object for the resolved module. If wrapped and this
    // is an inline require (not top-level), use a parcelRequire call, otherwise
    // the hoisted variable declared above. Otherwise, if not wrapped, use the
    // namespace export symbol.
    let obj =
      isWrapped && (!dep || dep?.meta.shouldWrap)
        ? `parcelRequire(${JSON.stringify(publicId)})`
        : isWrapped && dep
        ? `$${publicId}`
        : resolvedAsset.symbols.get('*')?.local ||
          `$${resolvedAsset.meta.id}$exports`;

    if (imported === '*' || exportSymbol === '*' || isDefaultInterop) {
      // Resolve to the namespace object if requested or this is a CJS default interop reqiure.
      return obj;
    } else if (
      (!staticExports || isWrapped || !symbol) &&
      resolvedAsset !== parentAsset
    ) {
      // If the resolved asset is wrapped or has non-static exports,
      // we need to use a member access off the namespace object rather
      // than a direct reference. If importing default from a CJS module,
      // use a helper to check the __esModule flag at runtime.
      if (
        exportSymbol === 'default' &&
        resolvedAsset.symbols.hasExportSymbol('*') &&
        this.needsDefaultInterop(resolvedAsset)
      ) {
        this.usedHelpers.add('$parcel$interopDefault');
        return `$parcel$interopDefault(${obj})`;
      } else {
        if (IDENTIFIER_RE.test(exportSymbol)) {
          return `${obj}.${exportSymbol}`;
        }

        return `${obj}[${JSON.stringify(exportSymbol)}]`;
      }
    } else if (!symbol) {
      // Asset was skipped or not found.
      // TODO: not sure about this.
      return '{}';
    } else {
      return symbol;
    }
  }

  getHoistedParcelRequires(
    parentAsset: Asset,
    dep: Dependency,
    resolved: Asset,
  ) {
    if (resolved.type !== 'js') {
      return ['', 0];
    }

    let hoisted = this.hoistedRequires.get(dep.id);
    let res = '';
    let lineCount = 0;
    let isWrapped =
      !this.bundle.hasAsset(resolved) ||
      (this.wrappedAssets.has(resolved.id) && resolved !== parentAsset);

    // If the resolved asset is wrapped and is imported in the top-level by this asset,
    // we need to run side effects when this asset runs. If the resolved asset is not
    // the first one in the hoisted requires, we need to insert a parcelRequire here
    // so it runs first.
    if (
      isWrapped &&
      !dep.meta.shouldWrap &&
      (!hoisted || hoisted.keys().next().value !== resolved.id) &&
      !this.bundleGraph.isDependencySkipped(dep) &&
      !this.shouldSkipAsset(resolved)
    ) {
      this.needsPrelude = true;
      res += `parcelRequire(${JSON.stringify(
        this.bundleGraph.getAssetPublicId(resolved),
      )});`;
    }

    if (hoisted) {
      this.needsPrelude = true;
      res += '\n' + [...hoisted.values()].join('\n');
      lineCount += hoisted.size;
    }

    return [res, lineCount];
  }

  buildAssetPrelude(asset: Asset, deps: Array<Dependency>) {
    let prepend = '';
    let prependLineCount = 0;
    let append = '';

    let shouldWrap = this.wrappedAssets.has(asset.id);
    let usedSymbols = this.bundleGraph.getUsedSymbols(asset);
    let assetId = asset.meta.id;
    invariant(typeof assetId === 'string');

    // If the asset has a namespace export symbol, it is CommonJS.
    // If there's no __esModule flag, and default is a used symbol, we need
    // to insert an interop helper.
    let defaultInterop =
      asset.symbols.hasExportSymbol('*') &&
      usedSymbols.has('default') &&
      !asset.symbols.hasExportSymbol('__esModule');

    // If the asset doesn't have static exports, should wrap, the namespace is used,
    // or we need default interop, then we need to synthesize a namespace object for
    // this asset.
    if (
      asset.meta.staticExports === false ||
      shouldWrap ||
      usedSymbols.has('*') ||
      defaultInterop
    ) {
      // Insert a declaration for the exports namespace object. If the asset is wrapped
      // we don't need to do this, because we'll use the `module.exports` object provided
      // by the wrapper instead.
      if (!shouldWrap) {
        prepend += `var $${assetId}$exports = {};\n`;
        prependLineCount++;
      }

      // Insert the __esModule interop flag for this module if it has a `default` export
      // and the namespace symbol is used.
      // TODO: only if required by CJS?
      if (asset.symbols.hasExportSymbol('default') && usedSymbols.has('*')) {
        prepend += `\n$parcel$defineInteropFlag($${assetId}$exports);\n`;
        prependLineCount += 2;
        this.usedHelpers.add('$parcel$defineInteropFlag');
      }

      // Find the used exports of this module. This is based on the used symbols of
      // incoming dependencies rather than the asset's own used exports so that we include
      // re-exported symbols rather than only symbols declared in this asset.
      let incomingDeps = this.bundleGraph.getIncomingDependencies(asset);
      let usedExports = [...asset.symbols.exportSymbols()].filter(symbol => {
        if (symbol === '*') {
          return false;
        }

        // If we need default interop, then all symbols are needed because the `default`
        // symbol really maps to the whole namespace.
        if (defaultInterop) {
          return true;
        }

        let unused = incomingDeps.every(d => {
          let symbols = this.bundleGraph.getUsedSymbols(d);
          return !symbols.has(symbol) && !symbols.has('*');
        });
        return !unused;
      });

      if (usedExports.length > 0) {
        // Insert $parcel$export calls for each of the used exports. This creates a getter/setter
        // for the symbol so that when the value changes the object property also changes. This is
        // required to simulate ESM live bindings. It's easier to do it this way rather than inserting
        // additional assignments after each mutation of the original binding.
        prepend += `\n${usedExports
          .map(exp => {
            let resolved = this.resolveSymbol(asset, asset, exp);
            // TODO: only include setter for CJS - ESM exports are constant.
            return `$parcel$export($${assetId}$exports, ${JSON.stringify(
              exp,
            )}, () => ${resolved}, (v) => ${resolved} = v);`;
          })
          .join('\n')}\n`;
        this.usedHelpers.add('$parcel$export');
        prependLineCount += 1 + usedExports.length;
      }

      // Find wildcard re-export dependencies, and make sure their exports are also included in ours.
      for (let dep of deps) {
        let resolved = this.bundleGraph.getDependencyResolution(
          dep,
          this.bundle,
        );
        if (!resolved || this.bundleGraph.isDependencySkipped(dep)) {
          continue;
        }

        let isWrapped = this.wrappedAssets.has(resolved.id);

        for (let [imported, {local}] of dep.symbols) {
          if (imported === '*' && local === '*') {
            // If the resolved asset has an exports object, use the $parcel$exportWildcard helper
            // to re-export all symbols. Otherwise, if there's no namespace object available, add
            // $parcel$export calls for each used symbol of the dependency.
            if (
              isWrapped ||
              resolved.meta.staticExports === false ||
              this.bundleGraph.getUsedSymbols(resolved).has('*')
            ) {
              let obj = this.resolveSymbol(asset, resolved, '*', dep);
              append += `$parcel$exportWildcard($${assetId}$exports, ${obj});\n`;
              this.usedHelpers.add('$parcel$exportWildcard');
            } else {
              for (let symbol of this.bundleGraph.getUsedSymbols(dep)) {
                let resolvedSymbol = this.resolveSymbol(
                  asset,
                  resolved,
                  symbol,
                );
                prepend += `$parcel$export($${assetId}$exports, ${JSON.stringify(
                  symbol,
                )}, () => ${resolvedSymbol}, (v) => ${resolvedSymbol} = v);\n`;
                prependLineCount++;
              }
            }
          }
        }
      }
    }

    return [prepend, prependLineCount, append];
  }

  buildBundlePrelude() {
    let enableSourceMaps = this.bundle.env.sourceMap;
    let res = '';
    let lines = 0;
    if (this.needsPrelude) {
      // Add the prelude if this is potentially the first JS bundle to load in a
      // particular context (e.g. entry scripts in HTML, workers, etc.).
      let parentBundles = this.bundleGraph.getParentBundles(this.bundle);
      let mightBeFirstJS =
        parentBundles.length === 0 ||
        parentBundles.some(b => b.type !== 'js') ||
        this.bundleGraph
          .getBundleGroupsContainingBundle(this.bundle)
          .some(g => this.bundleGraph.isEntryBundleGroup(g)) ||
        this.bundle.env.isIsolated() ||
        !!this.bundle.getMainEntry()?.isIsolated;

      if (mightBeFirstJS) {
        res = prelude(this.parcelRequireName);
        if (enableSourceMaps) {
          lines += countLines(res) - 1;
        }
      } else {
        // Otherwise, get the current parcelRequire global.
        res = `var parcelRequire = globalThis[${JSON.stringify(
          this.parcelRequireName,
        )}];\n`;
        lines++;
      }
    }

    // Add importScripts for sibling bundles in workers.
    if (this.bundle.env.isWorker()) {
      let importScripts = '';
      let bundles = this.bundleGraph.getReferencedBundles(this.bundle);
      for (let b of bundles) {
        importScripts += `importScripts("${relativeBundlePath(
          this.bundle,
          b,
        )}");\n`;
      }

      res += importScripts;
      lines += bundles.length;
    }

    // Add used helpers.
    for (let helper of this.usedHelpers) {
      res += helpers[helper];
      if (enableSourceMaps) {
        lines += countLines(helpers[helper]) - 1;
      }
    }

    return [res, lines];
  }

  needsDefaultInterop(asset: Asset) {
    if (
      asset.symbols.hasExportSymbol('*') &&
      !asset.symbols.hasExportSymbol('default')
    ) {
      let deps = this.bundleGraph.getIncomingDependencies(asset);
      return deps.some(
        dep =>
          this.bundle.hasDependency(dep) &&
          // dep.meta.isES6Module &&
          dep.symbols.hasExportSymbol('default'),
      );
    }

    return false;
  }

  shouldSkipAsset(asset: Asset) {
    return (
      asset.sideEffects === false &&
      this.bundleGraph.getUsedSymbols(asset).size == 0 &&
      !this.bundleGraph.isAssetReferencedByDependant(this.bundle, asset)
    );
  }
}
