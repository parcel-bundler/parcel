// @flow

import type {
  Blob,
  FilePath,
  BundleResult,
  Bundle as BundleType,
  BundleGraph as BundleGraphType,
  Stats
} from '@parcel/types';
import type SourceMap from '@parcel/source-map';
import type WorkerFarm from '@parcel/workers';
import type {Bundle as InternalBundle, ParcelOptions} from './types';
import type ParcelConfig from './ParcelConfig';
import type InternalBundleGraph from './BundleGraph';
import type {FileSystem, FileOptions} from '@parcel/fs';

import {
  urlJoin,
  md5FromObject,
  md5FromString,
  blobToStream
} from '@parcel/utils';
import {Readable} from 'stream';
import invariant from 'assert';
import nullthrows from 'nullthrows';
import path from 'path';
import url from 'url';

import {NamedBundle, bundleToInternalBundle} from './public/Bundle';
import {report} from './ReporterRunner';
import BundleGraph, {
  bundleGraphToInternalBundleGraph
} from './public/BundleGraph';
import PluginOptions from './public/PluginOptions';
import {PARCEL_VERSION} from './constants';

type Opts = {|
  config: ParcelConfig,
  farm?: WorkerFarm,
  options: ParcelOptions
|};

export default class PackagerRunner {
  config: ParcelConfig;
  options: ParcelOptions;
  farm: ?WorkerFarm;
  pluginOptions: PluginOptions;
  distDir: FilePath;
  distExists: Set<FilePath>;
  writeBundleFromWorker: ({
    bundle: InternalBundle,
    bundleGraphReference: number,
    config: ParcelConfig,
    cacheKey: string,
    options: ParcelOptions,
    ...
  }) => Promise<Stats>;

  constructor({config, farm, options}: Opts) {
    this.config = config;
    this.options = options;
    this.pluginOptions = new PluginOptions(this.options);

    this.farm = farm;
    this.writeBundleFromWorker = farm
      ? farm.createHandle('runPackage')
      : () => {
          throw new Error(
            'Cannot call PackagerRunner.writeBundleFromWorker() in a worker'
          );
        };
  }

  async writeBundles(bundleGraph: InternalBundleGraph) {
    let farm = nullthrows(this.farm);
    let {ref, dispose} = await farm.createSharedReference(bundleGraph);

    let promises = [];
    for (let bundle of bundleGraph.getBundles()) {
      // skip inline bundles, they will be processed via the parent bundle
      if (bundle.isInline) {
        continue;
      }

      promises.push(
        this.writeBundle(bundle, bundleGraph, ref).then(stats => {
          bundle.stats = stats;
        })
      );
    }

    await Promise.all(promises);
    await dispose();
  }

  async writeBundle(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    bundleGraphReference: number
  ) {
    let start = Date.now();

    let cacheKey = await this.getCacheKey(bundle, bundleGraph);
    let {size} =
      (await this.writeBundleFromCache({bundle, bundleGraph, cacheKey})) ||
      (await this.writeBundleFromWorker({
        bundle,
        cacheKey,
        bundleGraphReference,
        options: this.options,
        config: this.config
      }));

    return {
      time: Date.now() - start,
      size
    };
  }

  async writeBundleFromCache({
    bundle,
    bundleGraph,
    cacheKey
  }: {|
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    cacheKey: string
  |}) {
    if (this.options.disableCache) {
      return;
    }

    let cacheResult = await this.readFromCache(cacheKey);
    if (cacheResult == null) {
      return;
    }

    let {contents, map} = cacheResult;
    let {size} = await this.writeToDist({
      bundle,
      bundleGraph,
      contents,
      map
    });

    return {size};
  }

  async packageAndWriteBundle(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    cacheKey: string
  ) {
    let start = Date.now();

    let {contents, map} = await this.getBundleResult(
      bundle,
      bundleGraph,
      cacheKey
    );
    let {size} = await this.writeToDist({
      bundle,
      bundleGraph,
      contents,
      map
    });

    return {
      time: Date.now() - start,
      size
    };
  }

  async getBundleResult(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    cacheKey: ?string
  ): Promise<{|contents: Blob, map: ?(Readable | string)|}> {
    let result;
    if (!cacheKey && !this.options.disableCache) {
      cacheKey = await this.getCacheKey(bundle, bundleGraph);
      let cacheResult = await this.readFromCache(cacheKey);

      if (cacheResult) {
        // NOTE: Returning a new object for flow
        return {
          contents: cacheResult.contents,
          map: cacheResult.map
        };
      }
    }

    let packaged = await this.package(bundle, bundleGraph);
    let res = await this.optimize(
      bundle,
      bundleGraph,
      packaged.contents,
      packaged.map
    );

    let map = res.map ? await this.generateSourceMap(bundle, res.map) : null;
    result = {
      contents: res.contents,
      map
    };

    if (cacheKey != null) {
      await this.writeToCache(cacheKey, result.contents, map);

      if (result.contents instanceof Readable) {
        return {
          contents: this.options.cache.getStream(getContentKey(cacheKey)),
          map: result.map
        };
      }
    }

    return result;
  }

  async package(
    internalBundle: InternalBundle,
    bundleGraph: InternalBundleGraph
  ): Promise<BundleResult> {
    let bundle = new NamedBundle(internalBundle, bundleGraph, this.options);
    report({
      type: 'buildProgress',
      phase: 'packaging',
      bundle
    });

    let packager = await this.config.getPackager(bundle.filePath);
    let packaged = await packager.package({
      bundle,
      bundleGraph: new BundleGraph(bundleGraph, this.options),
      getSourceMapReference: map => {
        return bundle.isInline ||
          (bundle.target.sourceMap && bundle.target.sourceMap.inline)
          ? this.generateSourceMap(bundleToInternalBundle(bundle), map)
          : path.basename(bundle.filePath) + '.map';
      },
      options: this.pluginOptions,
      getInlineBundleContents: (
        bundle: BundleType,
        bundleGraph: BundleGraphType
      ) => {
        if (!bundle.isInline) {
          throw new Error(
            'Bundle is not inline and unable to retrieve contents'
          );
        }

        return this.getBundleResult(
          bundleToInternalBundle(bundle),
          bundleGraphToInternalBundleGraph(bundleGraph)
        );
      }
    });

    return {
      contents:
        typeof packaged.contents === 'string'
          ? replaceReferences(
              packaged.contents,
              generateDepToBundlePath(internalBundle, bundleGraph)
            )
          : packaged.contents,
      map: packaged.map
    };
  }

  async optimize(
    internalBundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    contents: Blob,
    map?: ?SourceMap
  ): Promise<BundleResult> {
    let bundle = new NamedBundle(internalBundle, bundleGraph, this.options);
    let optimizers = await this.config.getOptimizers(bundle.filePath);
    if (!optimizers.length) {
      return {contents, map};
    }

    report({
      type: 'buildProgress',
      phase: 'optimizing',
      bundle
    });

    let optimized = {contents, map};
    for (let optimizer of optimizers) {
      optimized = await optimizer.optimize({
        bundle,
        contents: optimized.contents,
        map: optimized.map,
        options: this.pluginOptions
      });
    }

    return optimized;
  }

  generateSourceMap(bundle: InternalBundle, map: SourceMap): Promise<string> {
    // sourceRoot should be a relative path between outDir and rootDir for node.js targets
    let filePath = nullthrows(bundle.filePath);
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

    let mapFilename = filePath + '.map';
    return map.stringify({
      file: path.basename(mapFilename),
      fs: this.options.inputFS,
      rootDir: this.options.projectRoot,
      sourceRoot: !inlineSources
        ? url.format(url.parse(sourceRoot + '/'))
        : undefined,
      inlineSources,
      inlineMap:
        bundle.isInline ||
        (bundle.target.sourceMap && bundle.target.sourceMap.inline)
    });
  }

  getCacheKey(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph
  ): string {
    let filePath = nullthrows(bundle.filePath);
    // TODO: include packagers and optimizers used in inline bundles as well
    let packager = this.config.getPackagerName(filePath);
    let optimizers = this.config.getOptimizerNames(filePath);
    let deps = Promise.all(
      [packager, ...optimizers].map(async pkg => {
        let {pkg: resolvedPkg} = await this.options.packageManager.resolve(
          `${pkg}/package.json`,
          `${this.config.filePath}/index`
        );

        let version = nullthrows(resolvedPkg).version;
        return [pkg, version];
      })
    );

    // TODO: add third party configs to the cache key
    let {minify, scopeHoist, sourceMaps} = this.options;
    return md5FromObject({
      parcelVersion: PARCEL_VERSION,
      deps,
      opts: {minify, scopeHoist, sourceMaps},
      hash: bundleGraph.getHash(bundle)
    });
  }

  async readFromCache(
    cacheKey: string
  ): Promise<?{|
    contents: Readable,
    map: ?Readable
  |}> {
    let contentKey = getContentKey(cacheKey);
    let mapKey = getMapKey(cacheKey);

    let contentExists = await this.options.cache.blobExists(contentKey);
    if (!contentExists) {
      return null;
    }

    let mapExists = await this.options.cache.blobExists(mapKey);

    return {
      contents: this.options.cache.getStream(contentKey),
      map: mapExists ? this.options.cache.getStream(mapKey) : null
    };
  }

  async writeToDist({
    bundle,
    bundleGraph,
    contents,
    map
  }: {|
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    contents: Blob,
    map: ?(Readable | string)
  |}) {
    let {inputFS, outputFS} = this.options;
    let filePath = nullthrows(bundle.filePath);
    let dir = path.dirname(filePath);
    await outputFS.mkdirp(dir); // ? Got rid of dist exists, is this an expensive operation

    // Use the file mode from the entry asset as the file mode for the bundle.
    // Don't do this for browser builds, as the executable bit in particular is unnecessary.
    let publicBundle = new NamedBundle(bundle, bundleGraph, this.options);
    let writeOptions = publicBundle.env.isBrowser()
      ? undefined
      : {
          mode: (await inputFS.stat(
            nullthrows(publicBundle.getMainEntry()).filePath
          )).mode
        };

    let size;
    if (contents instanceof Readable) {
      size = await writeFileStream(outputFS, filePath, contents, writeOptions);
    } else {
      await outputFS.writeFile(filePath, contents, writeOptions);
      size = contents.length;
    }

    if (map != null) {
      if (map instanceof Readable) {
        await writeFileStream(outputFS, filePath + '.map', map);
      } else {
        await outputFS.writeFile(filePath + '.map', map);
      }
    }

    return {size};
  }

  async writeToCache(cacheKey: string, contents: Blob, map: ?Blob) {
    let contentKey = getContentKey(cacheKey);

    await this.options.cache.setStream(contentKey, blobToStream(contents));

    if (map != null) {
      let mapKey = getMapKey(cacheKey);
      await this.options.cache.setStream(mapKey, blobToStream(map));
    }
  }
}

function writeFileStream(
  fs: FileSystem,
  filePath: FilePath,
  stream: Readable,
  options: ?FileOptions
): Promise<number> {
  return new Promise((resolve, reject) => {
    let fsStream = fs.createWriteStream(filePath, options);
    stream
      .pipe(fsStream)
      // $FlowFixMe
      .on('finish', () => resolve(fsStream.bytesWritten))
      .on('error', reject);
  });
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
  bundle: InternalBundle,
  bundleGraph: InternalBundleGraph
): Map<string, FilePath> {
  let depToBundlePath: Map<string, FilePath> = new Map();
  bundleGraph.traverseBundle(bundle, node => {
    if (node.type !== 'dependency') {
      return;
    }

    let dep = node.value;
    if (!dep.isURL || !dep.isAsync) {
      return;
    }

    let [bundleGroupNode] = bundleGraph._graph.getNodesConnectedFrom(node);
    invariant(bundleGroupNode && bundleGroupNode.type === 'bundle_group');

    let [entryBundleNode] = bundleGraph._graph.getNodesConnectedFrom(
      bundleGroupNode,
      'bundle'
    );
    invariant(entryBundleNode && entryBundleNode.type === 'bundle');

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

function getContentKey(cacheKey: string) {
  return md5FromString(`${cacheKey}:content`);
}

function getMapKey(cacheKey: string) {
  return md5FromString(`${cacheKey}:map`);
}
