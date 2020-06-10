// @flow strict-local

import type {BundleGraph, NamedBundle, Async} from '@parcel/types';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {Packager} from '@parcel/plugin';
import fs from 'fs';
import {concat, link, generate} from '@parcel/scope-hoisting';
import SourceMap from '@parcel/source-map';
import traverse from '@babel/traverse';
import {
  countLines,
  PromiseQueue,
  relativeBundlePath,
  replaceInlineReferences,
} from '@parcel/utils';
import path from 'path';

const PRELUDE = fs
  .readFileSync(path.join(__dirname, 'prelude.js'), 'utf8')
  .trim()
  .replace(/;$/, '');

export default new Packager({
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    options,
  }) {
    function replaceReferences({contents, map}) {
      return replaceInlineReferences({
        bundle,
        bundleGraph,
        contents,
        getInlineReplacement: (dependency, inlineType, content) => ({
          from: `"${dependency.id}"`,
          to: inlineType === 'string' ? JSON.stringify(content) : content,
        }),
        getInlineBundleContents,
        map,
      });
    }

    // If scope hoisting is enabled, we use a different code path.
    if (bundle.env.scopeHoist) {
      let wrappedAssets = new Set<string>();
      let {ast, referencedAssets} = link({
        bundle,
        bundleGraph,
        ast: await concat({bundle, bundleGraph, options, wrappedAssets}),
        options,
        wrappedAssets,
      });

      // Free up memory
      traverse.cache.clear();

      let {contents, map} = generate({
        bundleGraph,
        bundle,
        ast,
        referencedAssets,
        options,
      });
      return replaceReferences({
        contents:
          contents +
          '\n' +
          (await getSourceMapSuffix(getSourceMapReference, map)),
        map,
      });
    }

    if (bundle.env.outputFormat === 'esmodule') {
      throw new Error(
        `esmodule output is not supported without scope hoisting.`,
      );
    }

    // For development, we just concatenate all of the code together
    // rather then enabling scope hoisting, which would be too slow.
    let queue = new PromiseQueue({maxConcurrent: 32});
    bundle.traverse(node => {
      if (node.type === 'asset') {
        queue.add(async () => {
          let [code, mapBuffer] = await Promise.all([
            node.value.getCode(),
            bundle.target.sourceMap && node.value.getMapBuffer(),
          ]);
          return {code, mapBuffer};
        });
      }
    });

    let results = await queue.run();

    let assets = '';
    let i = 0;
    let first = true;
    let map = new SourceMap();

    let prefix = getPrefix(bundle, bundleGraph);
    let lineOffset = countLines(prefix);

    let stubsWritten = new Set();
    bundle.traverse(node => {
      let wrapped = first ? '' : ',';

      if (node.type === 'dependency') {
        let resolved = bundleGraph.getDependencyResolution(node.value, bundle);
        if (
          resolved &&
          resolved.type !== 'js' &&
          !stubsWritten.has(resolved.id)
        ) {
          // if this is a reference to another javascript asset, we should not include
          // its output, as its contents should already be loaded.
          invariant(!bundle.hasAsset(resolved));
          wrapped += JSON.stringify(resolved.id) + ':[function() {},{}]';
        } else {
          return;
        }
      }

      if (node.type === 'asset') {
        let asset = node.value;
        invariant(
          asset.type === 'js',
          'all assets in a js bundle must be js assets',
        );

        let deps = {};
        let dependencies = bundleGraph.getDependencies(asset);
        for (let dep of dependencies) {
          let resolved = bundleGraph.getDependencyResolution(dep, bundle);
          if (resolved) {
            deps[dep.moduleSpecifier] = resolved.id;
          }
        }

        let {code, mapBuffer} = results[i];
        let output = code || '';
        wrapped +=
          JSON.stringify(asset.id) +
          ':[function(require,module,exports) {\n' +
          output +
          '\n},';
        wrapped += JSON.stringify(deps);
        wrapped += ']';

        if (options.sourceMaps) {
          if (mapBuffer) {
            map.addBufferMappings(mapBuffer, lineOffset);
          } else {
            map.addEmptyMap(
              path
                .relative(options.projectRoot, asset.filePath)
                .replace(/\\+/g, '/'),
              output,
              lineOffset,
            );
          }

          lineOffset += countLines(output) + 1;
        }
        i++;
      }

      assets += wrapped;
      first = false;
    });

    let entries = bundle.getEntryAssets();
    if (!isEntry(bundle, bundleGraph) && bundle.env.outputFormat === 'global') {
      // The last entry is the main entry, but in async bundles we don't want it to execute until we require it
      // as there might be dependencies in a sibling bundle that hasn't loaded yet.
      entries.pop();
    }

    return replaceReferences({
      contents:
        prefix +
        '({' +
        assets +
        '},{},' +
        JSON.stringify(entries.map(asset => asset.id)) +
        ', ' +
        'null' +
        ')' +
        '\n\n' +
        (await getSourceMapSuffix(getSourceMapReference, map)),
      map,
    });
  },
});

function getPrefix(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): string {
  let interpreter: ?string;
  if (isEntry(bundle, bundleGraph) && !bundle.target.env.isBrowser()) {
    let _interpreter = nullthrows(bundle.getMainEntry()).meta.interpreter;
    invariant(_interpreter == null || typeof _interpreter === 'string');
    interpreter = _interpreter;
  }

  let importScripts = '';
  if (bundle.env.isWorker()) {
    let bundles = bundleGraph.getSiblingBundles(bundle);
    for (let b of bundles) {
      importScripts += `importScripts("${relativeBundlePath(bundle, b)}");\n`;
    }
  }

  return (
    // If the entry asset included a hashbang, repeat it at the top of the bundle
    (interpreter != null ? `#!${interpreter}\n` : '') + importScripts + PRELUDE
  );
}

function isEntry(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): boolean {
  return (
    !bundleGraph.hasParentBundleOfType(bundle, 'js') || bundle.env.isIsolated()
  );
}

async function getSourceMapSuffix(
  getSourceMapReference: (?SourceMap) => Async<?string>,
  map: ?SourceMap,
): Promise<string> {
  let sourcemapReference = await getSourceMapReference(map);
  if (sourcemapReference != null) {
    return '//# sourceMappingURL=' + sourcemapReference + '\n';
  } else {
    return '';
  }
}
