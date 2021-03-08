// @flow

import type {Asset, BundleGraph, NamedBundle, Async} from '@parcel/types';

import {Packager} from '@parcel/plugin';
import {PromiseQueue, relativeUrl, relativePath} from '@parcel/utils';
import nullthrows from 'nullthrows';

const prelude = `var $parcel$modules = {};
var $parcel$inits = {};

var parcelRequireName = "parcelRequire123";
var parcelRequire = globalThis[parcelRequireName];
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

  globalThis[parcelRequireName] = parcelRequire;
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
            let code = await node.value.getCode();
            return [node.value.id, {asset: node.value, code}];
          });
          if (node.value.meta.shouldWrap) {
            wrappedAssets.add(node.value.id);
            return true;
          }
      }
    });

    let outputs = new Map<string, {|asset: Asset, code: string|}>(
      await queue.run(),
    );

    let needsPrelude = false;
    let usedHelpers = new Set();
    let interopDefaults = new Set();
    let seen = new Set();
    let visit = id => {
      if (seen.has(id)) {
        return '';
      }

      seen.add(id);

      let {asset, code} = nullthrows(outputs.get(id));
      let shouldWrap = wrappedAssets.has(id);
      let deps = bundleGraph.getDependencies(asset);

      if (shouldSkipAsset(bundleGraph, bundle, asset)) {
        let depCode = '';
        // TODO: order?
        for (let dep of deps) {
          let resolved = bundleGraph.getDependencyResolution(dep, bundle);
          let skipped = bundleGraph.isDependencySkipped(dep);
          if (!resolved || skipped) continue;
          if (bundle.hasAsset(resolved)) {
            depCode += visit(resolved.id) + '\n';
          } /*else if (resolved.type === 'js') {
            needsPrelude = true;
            depCode += `parcelRequire(${JSON.stringify(resolved.id)});`;
          }*/
        }

        return depCode;
      }

      // TODO: maybe a meta prop?
      if (code.includes('$parcel$global')) {
        usedHelpers.add('$parcel$global');
      }

      let usedSymbols = bundleGraph.getUsedSymbols(asset);

      let resolveSymbol = (resolved, imported) => {
        let {
          asset: resolvedAsset,
          exportSymbol,
          symbol,
        } = bundleGraph.resolveSymbol(resolved, imported, bundle);
        let isWrapped =
          wrappedAssets.has(resolvedAsset.id) && resolvedAsset !== asset;
        let staticExports = resolvedAsset.meta.staticExports !== false;
        // TODO: if resolvedAsset.meta.shouldWrap, then the parcelRequire should go at the import site
        let obj = isWrapped
          ? `parcelRequire(${JSON.stringify(resolvedAsset.id)})`
          : resolvedAsset.symbols.get('*')?.local ||
            `$${resolvedAsset.id}$exports`;
        if (imported === '*' || exportSymbol === '*') {
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
            // TODO: not great...
            let interop = `$${resolvedAsset.id}$interop$default`;
            return isWrapped ? `(${obj}, ${interop})` : interop;
          } else {
            return `${obj}.${exportSymbol}`;
          }
        } else {
          return symbol;
        }
      };

      let replacements = new Map();
      for (let dep of deps) {
        let resolved = bundleGraph.getDependencyResolution(dep, bundle);
        if (!resolved || resolved === asset) continue;
        for (let [imported, {local}] of dep.symbols) {
          if (local === '*') continue;
          replacements.set(local, resolveSymbol(resolved, imported));
        }
      }

      if (replacements.size > 0) {
        let regex = new RegExp(
          [...replacements.keys()]
            .map(k => k.replace(/[$]/g, '\\$&'))
            .join('|'),
          'g',
        );
        code = code.replace(regex, m => replacements.get(m));
      }

      if (
        asset.meta.staticExports === false ||
        shouldWrap ||
        usedSymbols.has('*')
      ) {
        let keys =
          usedSymbols.has('*') || asset.symbols.hasExportSymbol('*')
            ? asset.symbols.exportSymbols()
            : [...usedSymbols];
        let prepend = '';
        prepend += `\nvar $${id}$exports = {\n};\n`;

        // TODO: only if required by CJS?
        if (asset.symbols.hasExportSymbol('default') && usedSymbols.has('*')) {
          prepend += `\n$parcel$defineInteropFlag($${id}$exports);\n`;
          usedHelpers.add('$parcel$defineInteropFlag');
        }

        let usedExports = [...keys].filter(exp => exp !== '*');
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
        }

        for (let dep of deps) {
          let resolved = bundleGraph.getDependencyResolution(dep, bundle);
          if (!resolved) continue;

          let isWrapped = wrappedAssets.has(resolved.id);
          let obj = isWrapped
            ? `parcelRequire(${JSON.stringify(resolved.id)})`
            : resolved.symbols.get('*')?.local || `$${resolved.id}$exports`;

          for (let [imported, {local}] of dep.symbols) {
            if (imported === '*' && local === '*') {
              code += `\n$parcel$exportWildcard($${id}$exports, ${obj});`;
              usedHelpers.add('$parcel$exportWildcard');
            }
          }
        }

        code = prepend + code;
      }

      if (shouldWrap) {
        needsPrelude = true;

        let exportsName =
          asset.symbols.get('*')?.local || `$${asset.id}$exports`;
        let depCode = '';
        for (let dep of deps) {
          let resolved = nullthrows(
            bundleGraph.getDependencyResolution(dep, bundle),
          );
          depCode += visit(resolved.id) + '\n';
          // TODO: use regex, like below
          code = code.replaceAll(
            `import   "${asset.id}:${dep.moduleSpecifier}";`,
            dep.meta.shouldWrap
              ? ''
              : `\nparcelRequire(${JSON.stringify(resolved.id)});`,
          );
        }

        if (needsDefaultInterop(bundleGraph, bundle, asset)) {
          // invariant: have exports object
          depCode += `var $${id}$interop$default;\n`;
          code += `$${id}$interop$default = /*@__PURE__*/$parcel$interopDefault(module.exports);\n`;
          usedHelpers.add('$parcel$interopDefault');
        }

        code = `
        ${depCode}
parcelRequire.register(${JSON.stringify(id)}, function(module, exports) {
  ${code
    .replaceAll(`var ${exportsName} = {\n};\n`, '')
    .replaceAll(exportsName, 'module.exports')}
});
`;
      } else {
        if (needsDefaultInterop(bundleGraph, bundle, asset)) {
          // invariant: have exports object
          code += `var $${id}$interop$default = /*@__PURE__*/$parcel$interopDefault($${id}$exports);\n`;
          usedHelpers.add('$parcel$interopDefault');
        }

        let depMap = new Map();
        for (let dep of deps) {
          let resolved = bundleGraph.getDependencyResolution(dep, bundle);
          let skipped = bundleGraph.isDependencySkipped(dep);
          if (!resolved || skipped) continue; // TODO
          depMap.set(`${asset.meta.id}:${dep.moduleSpecifier}`, resolved);
        }

        code = code.replace(/import\s+"(.+?)";\n/g, (m, dep) => {
          let resolved = depMap.get(dep);
          if (resolved) {
            if (bundle.hasAsset(resolved)) {
              return visit(resolved.id);
            } else if (resolved.type === 'js') {
              needsPrelude = true;
              return `parcelRequire(${JSON.stringify(resolved.id)});`;
            }
          }
          return '';
        });
      }

      return code;
    };

    let entries = bundle.getEntryAssets();
    let res = '';
    for (let entry of entries) {
      res += visit(entry.id) + '\n';
    }

    for (let helper of usedHelpers) {
      res = helpers[helper] + res;
    }

    if (needsPrelude) {
      res = prelude + res;
    }

    for (let entry of entries) {
      if (wrappedAssets.has(entry.id)) {
        res += `\nparcelRequire(${JSON.stringify(entry.id)});\n`;
      }
    }

    res = `(function () {
  ${res}
})();`;

    // console.log(res)

    return {
      contents: res,
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
