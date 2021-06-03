// @flow strict-local
import type {BundleGraph, PluginOptions, NamedBundle} from '@parcel/types';

import {PromiseQueue, relativeBundlePath, countLines} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import invariant from 'assert';
import path from 'path';
import fs from 'fs';

const PRELUDE = fs
  .readFileSync(path.join(__dirname, 'dev-prelude.js'), 'utf8')
  .trim()
  .replace(/;$/, '');

export class DevPackager {
  options: PluginOptions;
  bundleGraph: BundleGraph<NamedBundle>;
  bundle: NamedBundle;
  parcelRequireName: string;

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
  }

  async package(): Promise<{|contents: string, map: ?SourceMap|}> {
    // Load assets
    let queue = new PromiseQueue({maxConcurrent: 32});
    this.bundle.traverse(node => {
      if (node.type === 'asset') {
        queue.add(async () => {
          let [code, mapBuffer] = await Promise.all([
            node.value.getCode(),
            this.bundle.env.sourceMap && node.value.getMapBuffer(),
          ]);
          return {code, mapBuffer};
        });
      }
    });

    let results = await queue.run();

    let assets = '';
    let i = 0;
    let first = true;
    let map = new SourceMap(this.options.projectRoot);

    let prefix = this.getPrefix();
    let lineOffset = countLines(prefix);

    this.bundle.traverse(node => {
      let wrapped = first ? '' : ',';

      if (node.type === 'dependency') {
        let resolved = this.bundleGraph.getDependencyResolution(
          node.value,
          this.bundle,
        );
        if (resolved && resolved.type !== 'js') {
          // if this is a reference to another javascript asset, we should not include
          // its output, as its contents should already be loaded.
          invariant(!this.bundle.hasAsset(resolved));
          wrapped +=
            JSON.stringify(this.bundleGraph.getAssetPublicId(resolved)) +
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
        let dependencies = this.bundleGraph.getDependencies(asset);
        for (let dep of dependencies) {
          let resolved = this.bundleGraph.getDependencyResolution(
            dep,
            this.bundle,
          );
          if (resolved) {
            deps[dep.moduleSpecifier] = this.bundleGraph.getAssetPublicId(
              resolved,
            );
          }
        }

        let {code, mapBuffer} = results[i];
        let output = code || '';
        wrapped +=
          JSON.stringify(this.bundleGraph.getAssetPublicId(asset)) +
          ':[function(require,module,exports) {\n' +
          output +
          '\n},';
        wrapped += JSON.stringify(deps);
        wrapped += ']';

        if (this.bundle.env.sourceMap) {
          if (mapBuffer) {
            map.addBuffer(mapBuffer, lineOffset);
          } else {
            map.addEmptyMap(
              path
                .relative(this.options.projectRoot, asset.filePath)
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

    let entries = this.bundle.getEntryAssets();
    let mainEntry = this.bundle.getMainEntry();
    if (!this.isEntry() && this.bundle.env.outputFormat === 'global') {
      // In async bundles we don't want the main entry to execute until we require it
      // as there might be dependencies in a sibling bundle that hasn't loaded yet.
      entries = entries.filter(a => a.id !== mainEntry?.id);
      mainEntry = null;
    }

    let contents =
      prefix +
      '({' +
      assets +
      '},' +
      JSON.stringify(
        entries.map(asset => this.bundleGraph.getAssetPublicId(asset)),
      ) +
      ', ' +
      JSON.stringify(
        mainEntry ? this.bundleGraph.getAssetPublicId(mainEntry) : null,
      ) +
      ', ' +
      JSON.stringify(this.parcelRequireName) +
      ')' +
      '\n';

    return {
      contents,
      map,
    };
  }

  getPrefix(): string {
    let interpreter: ?string;
    let mainEntry = this.bundle.getMainEntry();
    if (mainEntry && this.isEntry() && !this.bundle.target.env.isBrowser()) {
      let _interpreter = mainEntry.meta.interpreter;
      invariant(_interpreter == null || typeof _interpreter === 'string');
      interpreter = _interpreter;
    }

    let importScripts = '';
    if (this.bundle.env.isWorker()) {
      let bundles = this.bundleGraph.getReferencedBundles(this.bundle);
      for (let b of bundles) {
        importScripts += `importScripts("${relativeBundlePath(
          this.bundle,
          b,
        )}");\n`;
      }
    }

    return (
      // If the entry asset included a hashbang, repeat it at the top of the bundle
      (interpreter != null ? `#!${interpreter}\n` : '') +
      importScripts +
      PRELUDE
    );
  }

  isEntry(): boolean {
    return (
      !this.bundleGraph.hasParentBundleOfType(this.bundle, 'js') ||
      this.bundle.env.isIsolated() ||
      !!this.bundle.getMainEntry()?.isIsolated
    );
  }
}
