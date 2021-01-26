// @flow strict-local

import type {BundleGraph, NamedBundle, Async} from '@parcel/types';

import invariant from 'assert';
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
  md5FromString,
  loadConfig,
} from '@parcel/utils';
import path from 'path';
import nullthrows from 'nullthrows';

const PRELUDE = fs
  .readFileSync(path.join(__dirname, 'prelude.js'), 'utf8')
  .trim()
  .replace(/;$/, '');

export default (new Packager({
  async loadConfig({options}) {
    // Generate a name for the global parcelRequire function that is unique to this project.
    // This allows multiple parcel builds to coexist on the same page.
    let pkg = await loadConfig(
      options.inputFS,
      path.join(options.entryRoot, 'index'),
      ['package.json'],
    );
    let name = pkg?.config.name ?? '';
    return {
      config: {
        parcelRequireName: 'parcelRequire' + md5FromString(name).slice(-4),
      },
      files: pkg?.files ?? [],
    };
  },
  async package({
    bundle,
    bundleGraph,
    getInlineBundleContents,
    getSourceMapReference,
    config,
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

    let parcelRequireName = nullthrows(config).parcelRequireName;

    // If scope hoisting is enabled, we use a different code path.
    if (bundle.env.shouldScopeHoist) {
      let wrappedAssets = new Set<string>();
      let {ast, referencedAssets} = link({
        bundle,
        bundleGraph,
        ast: await concat({
          bundle,
          bundleGraph,
          options,
          wrappedAssets,
          parcelRequireName,
        }),
        options,
        wrappedAssets,
        parcelRequireName,
      });

      // Free up memory
      traverse.cache.clear();

      let {contents, map} = generate({
        bundleGraph,
        bundle,
        ast,
        referencedAssets,
        parcelRequireName,
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
            bundle.env.sourceMap && node.value.getMapBuffer(),
          ]);
          return {code, mapBuffer};
        });
      }
    });

    let results = await queue.run();

    let assets = '';
    let i = 0;
    let first = true;
    let map = new SourceMap(options.projectRoot);

    let prefix = getPrefix(bundle, bundleGraph);
    let lineOffset = countLines(prefix);

    bundle.traverse(node => {
      let wrapped = first ? '' : ',';

      if (node.type === 'dependency') {
        let resolved = bundleGraph.getDependencyResolution(node.value, bundle);
        if (resolved && resolved.type !== 'js') {
          // if this is a reference to another javascript asset, we should not include
          // its output, as its contents should already be loaded.
          invariant(!bundle.hasAsset(resolved));
          wrapped +=
            JSON.stringify(bundleGraph.getAssetPublicId(resolved)) +
            ':[function() {},{}]';
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
            deps[dep.moduleSpecifier] = bundleGraph.getAssetPublicId(resolved);
          }
        }

        let {code, mapBuffer} = results[i];
        let output = code || '';
        wrapped +=
          JSON.stringify(bundleGraph.getAssetPublicId(asset)) +
          ':[function(require,module,exports) {\n' +
          output +
          '\n},';
        wrapped += JSON.stringify(deps);
        wrapped += ']';

        if (bundle.env.sourceMap) {
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
    let mainEntry = bundle.getMainEntry();
    if (!isEntry(bundle, bundleGraph) && bundle.env.outputFormat === 'global') {
      // In async bundles we don't want the main entry to execute until we require it
      // as there might be dependencies in a sibling bundle that hasn't loaded yet.
      entries = entries.filter(a => a.id !== mainEntry?.id);
      mainEntry = null;
    }

    return replaceReferences({
      contents:
        prefix +
        '({' +
        assets +
        '},' +
        JSON.stringify(
          entries.map(asset => bundleGraph.getAssetPublicId(asset)),
        ) +
        ', ' +
        JSON.stringify(
          mainEntry ? bundleGraph.getAssetPublicId(mainEntry) : null,
        ) +
        ', ' +
        JSON.stringify(parcelRequireName) +
        ')' +
        '\n\n' +
        (await getSourceMapSuffix(getSourceMapReference, map)),
      map,
    });
  },
}): Packager);

function getPrefix(
  bundle: NamedBundle,
  bundleGraph: BundleGraph<NamedBundle>,
): string {
  let interpreter: ?string;
  let mainEntry = bundle.getMainEntry();
  if (
    mainEntry &&
    isEntry(bundle, bundleGraph) &&
    !bundle.target.env.isBrowser()
  ) {
    let _interpreter = mainEntry.meta.interpreter;
    invariant(_interpreter == null || typeof _interpreter === 'string');
    interpreter = _interpreter;
  }

  let importScripts = '';
  if (bundle.env.isWorker()) {
    let bundles = bundleGraph.getReferencedBundles(bundle);
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
    !bundleGraph.hasParentBundleOfType(bundle, 'js') ||
    bundle.env.isIsolated() ||
    !!bundle.getMainEntry()?.isIsolated
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
