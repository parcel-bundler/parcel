// @flow

import {Readable} from 'stream';
import type {ParcelOptions, Blob, FilePath} from '@parcel/types';
import type {Bundle as InternalBundle} from './types';
import type Config from './Config';

import invariant from 'assert';
import {mkdirp, writeFile, writeFileStream} from '@parcel/fs';
import {TapStream, urlRelative} from '@parcel/utils';
import {NamedBundle} from './public/Bundle';
import nullthrows from 'nullthrows';
import path from 'path';
import {report} from './ReporterRunner';

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

  async writeBundle(bundle: InternalBundle) {
    let start = Date.now();
    let contents = await this.package(bundle);
    contents = await this.optimize(bundle, contents);

    let filePath = nullthrows(bundle.filePath);
    let dir = path.dirname(filePath);
    if (!this.distExists.has(dir)) {
      await mkdirp(dir);
      this.distExists.add(dir);
    }

    let size;
    if (contents instanceof Readable) {
      size = 0;
      await writeFileStream(
        filePath,
        contents.pipe(new TapStream(chunk => (size += chunk.length)))
      );
    } else {
      await writeFile(filePath, contents);
      size = contents.length;
    }

    return {
      time: Date.now() - start,
      size
    };
  }

  async package(internalBundle: InternalBundle): Promise<Blob> {
    let bundle = new NamedBundle(internalBundle);
    report({
      type: 'buildProgress',
      phase: 'packaging',
      bundle
    });

    let depToBundlePath = generateDepToBundlePath(internalBundle);

    let packager = await this.config.getPackager(bundle.filePath);
    let packageContent = await packager.package(bundle, this.options);

    return typeof packageContent === 'string'
      ? replaceReferences(packageContent, depToBundlePath)
      : packageContent;
  }

  async optimize(
    internalBundle: InternalBundle,
    contents: Blob
  ): Promise<Blob> {
    let bundle = new NamedBundle(internalBundle);
    let optimizers = await this.config.getOptimizers(bundle.filePath);
    if (!optimizers.length) {
      return contents;
    }

    report({
      type: 'buildProgress',
      phase: 'optimizing',
      bundle
    });

    for (let optimizer of optimizers) {
      contents = await optimizer.optimize(bundle, contents, this.options);
    }

    return contents;
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
      urlRelative(nullthrows(bundle.name), nullthrows(entryBundle.name))
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
