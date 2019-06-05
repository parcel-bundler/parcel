// @flow

import type {ParcelOptions, Blob, FilePath} from '@parcel/types';
import type SourceMap from '@parcel/source-map';
import type {Bundle as InternalBundle} from './types';
import type Config from './Config';
import type InternalBundleGraph from './BundleGraph';

import {Readable} from 'stream';
import invariant from 'assert';
import {mkdirp, writeFile, writeFileStream} from '@parcel/fs';
import {urlJoin} from '@parcel/utils';
import {NamedBundle} from './public/Bundle';
import nullthrows from 'nullthrows';
import path from 'path';
import {report} from './ReporterRunner';
import {BundleGraph} from './public/BundleGraph';

type Opts = {|
  config: Config,
  options: ParcelOptions
|};

export default class PackagerRunner {
  config: Config;
  options: ParcelOptions;
  distDir: FilePath;
  distExists: Set<FilePath>;

  constructor({config, options}: Opts) {
    this.config = config;
    this.options = options;
    this.distExists = new Set();
  }

  async writeBundle(bundle: InternalBundle, bundleGraph: InternalBundleGraph) {
    let start = Date.now();
    let packaged = await this.package(bundle, bundleGraph);
    let {contents, map} = await this.optimize(
      bundle,
      packaged.contents,
      packaged.map
    );

    let filePath = nullthrows(bundle.filePath);
    let dir = path.dirname(filePath);
    if (!this.distExists.has(dir)) {
      await mkdirp(dir);
      this.distExists.add(dir);
    }

    let size;
    if (contents instanceof Readable) {
      size = await writeFileStream(filePath, contents);
    } else {
      await writeFile(filePath, contents);
      size = contents.length;
    }

    if (map) {
      // sourceRoot should be a relative path between outDir and rootDir for node.js targets
      let sourceRoot: string = path.relative(
        path.dirname(filePath),
        this.options.projectRoot
      );
      let inlineSources = false;

      if (bundle.target) {
        if (
          bundle.target.sourceMap &&
          bundle.target.sourceMap.sourceRoot !== undefined
        ) {
          sourceRoot = bundle.target.sourceMap.sourceRoot;
        } else if (
          bundle.target.env.context === 'browser' &&
          this.options.mode !== 'production'
        ) {
          sourceRoot = '/__parcel_source_root';
        }

        if (
          bundle.target.sourceMap &&
          bundle.target.sourceMap.inlineSources !== undefined
        ) {
          inlineSources = bundle.target.sourceMap.inlineSources;
        } else if (bundle.target.env.context !== 'node') {
          // inlining should only happen in production for browser targets by default
          inlineSources = this.options.mode === 'production';
        }
      }

      // TODO: Find a more proper/cross platform way to format urls...
      if (sourceRoot) {
        sourceRoot += '/';
      }

      await writeFile(
        filePath + '.map',
        await map.stringify({
          // TODO: Fix file as it's currently not keeping in mind publicUrl...
          file: filePath,
          rootDir: this.options.projectRoot,
          sourceRoot: !inlineSources ? sourceRoot : undefined,
          inlineSources
        })
      );
    }

    return {
      time: Date.now() - start,
      size
    };
  }

  async package(
    internalBundle: InternalBundle,
    bundleGraph: InternalBundleGraph
  ): Promise<{|contents: Blob, map?: ?SourceMap|}> {
    let bundle = new NamedBundle(internalBundle);
    report({
      type: 'buildProgress',
      phase: 'packaging',
      bundle
    });

    let packager = await this.config.getPackager(bundle.filePath);
    let packaged = await packager.package({
      bundle,
      bundleGraph: new BundleGraph(bundleGraph),
      options: this.options
    });

    return {
      contents:
        typeof packaged.contents === 'string'
          ? replaceReferences(
              packaged.contents,
              generateDepToBundlePath(internalBundle)
            )
          : packaged.contents,
      map: packaged.map
    };
  }

  async optimize(
    internalBundle: InternalBundle,
    contents: Blob,
    map?: ?SourceMap
  ): Promise<{contents: Blob, map?: ?SourceMap}> {
    let bundle = new NamedBundle(internalBundle);
    let optimizers = await this.config.getOptimizers(bundle.filePath);
    if (!optimizers.length) {
      return {contents, map};
    }

    report({
      type: 'buildProgress',
      phase: 'optimizing',
      bundle
    });

    let optimized;
    for (let optimizer of optimizers) {
      optimized = await optimizer.optimize({
        bundle,
        contents,
        map,
        options: this.options
      });
    }
    invariant(optimized != null);

    return optimized;
  }
}

/*
 * Build a mapping from async, url dependency ids to web-friendly relative paths
 * to their bundles. These will be relative to the current bundle if `publicUrl`
 * is not provided. If `publicUrl` is provided, the paths will be joined to it.
 *
 * These are used to translate any placeholder dependency ids written during
 * transformation back to a path that can be loaded in a browser (such as
 * in a "raw" loader or any transformed dependencies referred to by url).
 */
function generateDepToBundlePath(
  bundle: InternalBundle
): Map<string, FilePath> {
  let depToBundlePath: Map<string, FilePath> = new Map();
  bundle.assetGraph.traverse(node => {
    if (node.type !== 'dependency') {
      return;
    }

    let dep = node.value;
    if (!dep.isURL || !dep.isAsync) {
      return;
    }

    let [bundleGroupNode] = bundle.assetGraph.getNodesConnectedFrom(node);
    invariant(bundleGroupNode && bundleGroupNode.type === 'bundle_group');

    let [entryBundleNode] = bundle.assetGraph.getNodesConnectedFrom(
      bundleGroupNode
    );
    invariant(entryBundleNode && entryBundleNode.type === 'bundle_reference');

    let entryBundle = entryBundleNode.value;
    depToBundlePath.set(
      dep.id,
      urlJoin(
        nullthrows(entryBundle.target).publicUrl ?? '/',
        nullthrows(entryBundle.name)
      )
    );
  });
  return depToBundlePath;
}

// replace references to url dependencies with relative paths to their
// corresponding bundles.
// TODO: This likely alters the length of the column in the source text.
//       Update any sourcemaps accordingly.
function replaceReferences(
  code: string,
  depToBundlePath: Map<string, FilePath>
): string {
  let output = code;
  for (let [depId, replacement] of depToBundlePath) {
    let split = output.split(depId);
    if (split.length > 1) {
      // the dependency id was found in the text. replace it.
      output = split.join(replacement);
    }
  }

  return output;
}
