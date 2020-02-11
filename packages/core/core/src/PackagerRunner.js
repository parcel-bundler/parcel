// @flow strict-local

import type {
  Blob,
  FilePath,
  BundleResult,
  Bundle as BundleType,
  BundleGraph as BundleGraphType,
} from '@parcel/types';
import type SourceMap from '@parcel/source-map';
import type WorkerFarm from '@parcel/workers';
import type {Bundle as InternalBundle, ParcelOptions, ReportFn} from './types';
import type ParcelConfig from './ParcelConfig';
import type InternalBundleGraph from './BundleGraph';
import type {FileSystem, FileOptions} from '@parcel/fs';

import {
  md5FromObject,
  md5FromString,
  blobToStream,
  TapStream,
} from '@parcel/utils';
import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {Readable} from 'stream';
import nullthrows from 'nullthrows';
import path from 'path';
import url from 'url';
import crypto from 'crypto';

import {NamedBundle, bundleToInternalBundle} from './public/Bundle';
import BundleGraph, {
  bundleGraphToInternalBundleGraph,
} from './public/BundleGraph';
import PluginOptions from './public/PluginOptions';
import {PARCEL_VERSION} from './constants';

type Opts = {|
  config: ParcelConfig,
  farm?: WorkerFarm,
  options: ParcelOptions,
  report: ReportFn,
|};

type BundleInfo = {|
  hash: string,
  hashReferences: Array<string>,
  time: number,
|};

export default class PackagerRunner {
  config: ParcelConfig;
  options: ParcelOptions;
  farm: ?WorkerFarm;
  pluginOptions: PluginOptions;
  distDir: FilePath;
  distExists: Set<FilePath>;
  report: ReportFn;
  getBundleInfoFromWorker: ({|
    bundle: InternalBundle,
    bundleGraphReference: number,
    config: ParcelConfig,
    cacheKey: string,
    options: ParcelOptions,
  |}) => Promise<BundleInfo>;

  constructor({config, farm, options, report}: Opts) {
    this.config = config;
    this.options = options;
    this.pluginOptions = new PluginOptions(this.options);

    this.farm = farm;
    this.report = report;
    this.getBundleInfoFromWorker = farm
      ? farm.createHandle('runPackage')
      : () => {
          throw new Error(
            'Cannot call PackagerRunner.writeBundleFromWorker() in a worker',
          );
        };
  }

  async writeBundles(bundleGraph: InternalBundleGraph) {
    let farm = nullthrows(this.farm);
    let {ref, dispose} = await farm.createSharedReference(bundleGraph);

    let bundleInfoMap = {};
    // ? hashRef should maybe just be first 8 digits of id, but that would require that id is an md5 hash already
    //  - only reason I'm not doing that right now is that it feels like we're doing a bunch of hashes of hashes
    //  - not sure if that's a bad thing or not
    let hashRefToId = {};
    // skip inline bundles, they will be processed via the parent bundle
    let bundles = bundleGraph.getBundles().filter(bundle => !bundle.isInline);
    await Promise.all(
      bundles.map(async bundle => {
        let info = await this.processBundle(bundle, bundleGraph, ref);
        hashRefToId[bundle.hashReference] = bundle.id;
        bundleInfoMap[bundle.id] = info;
      }),
    );
    let hashRefToNameHash = generateHashRefToNameHashMap(
      bundles,
      bundleInfoMap,
      hashRefToId,
    );
    await Promise.all(
      bundles.map(bundle =>
        this.writeToDist({
          bundle,
          info: bundleInfoMap[bundle.id],
          hashRefToNameHash,
          bundleGraph,
        }),
      ),
    );
    await dispose();
  }

  async processBundle(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    bundleGraphReference: number,
  ): Promise<{|...BundleInfo, cacheKey: string|}> {
    let start = Date.now();

    let cacheKey = await this.getCacheKey(bundle, bundleGraph);
    let {hash, hashReferences} =
      (await this.getBundleInfoFromCache()) ??
      (await this.getBundleInfoFromWorker({
        bundle,
        bundleGraphReference,
        cacheKey,
        options: this.options,
        config: this.config,
      }));

    return {time: Date.now() - start, hash, hashReferences, cacheKey};
  }

  getBundleInfoFromCache() {
    // TODO: implement
    return null;
  }

  async getBundleInfo(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    cacheKey: ?string,
  ) {
    let {contents, map} = await this.getBundleResult(bundle, bundleGraph);

    let info = {};
    // ? Why would cacheKey be null
    if (cacheKey != null) {
      info = await this.writeToCache(cacheKey, contents, map);
    }

    return info;
  }

  async getBundleResult(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
  ): Promise<{|contents: Blob, map: ?(Readable | string)|}> {
    let packaged = await this.package(bundle, bundleGraph);
    let res = await this.optimize(
      bundle,
      bundleGraph,
      packaged.contents,
      packaged.map,
    );

    let map = res.map ? await this.generateSourceMap(bundle, res.map) : null;
    return {
      contents: res.contents,
      map,
    };
  }

  async package(
    internalBundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
  ): Promise<BundleResult> {
    let bundle = new NamedBundle(internalBundle, bundleGraph, this.options);
    // ? How should we print progress for names with hash references?
    this.report({
      type: 'buildProgress',
      phase: 'packaging',
      bundle,
    });

    let packager = await this.config.getPackager(bundle.filePath);
    try {
      return await packager.plugin.package({
        bundle,
        bundleGraph: new BundleGraph(bundleGraph, this.options),
        getSourceMapReference: map => {
          return bundle.isInline ||
            (bundle.target.sourceMap && bundle.target.sourceMap.inline)
            ? this.generateSourceMap(bundleToInternalBundle(bundle), map)
            : path.basename(bundle.filePath) + '.map';
        },
        options: this.pluginOptions,
        logger: new PluginLogger({origin: packager.name}),
        getInlineBundleContents: (
          bundle: BundleType,
          bundleGraph: BundleGraphType,
        ) => {
          if (!bundle.isInline) {
            throw new Error(
              'Bundle is not inline and unable to retrieve contents',
            );
          }

          return this.getBundleResult(
            bundleToInternalBundle(bundle),
            bundleGraphToInternalBundleGraph(bundleGraph),
          );
        },
      });
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, packager.name),
      });
    }
  }

  async optimize(
    internalBundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    contents: Blob,
    map?: ?SourceMap,
  ): Promise<BundleResult> {
    let bundle = new NamedBundle(internalBundle, bundleGraph, this.options);
    let optimizers = await this.config.getOptimizers(
      bundle.filePath,
      internalBundle.pipeline,
    );
    if (!optimizers.length) {
      return {contents, map};
    }

    this.report({
      type: 'buildProgress',
      phase: 'optimizing',
      bundle,
    });

    let optimized = {contents, map};
    for (let optimizer of optimizers) {
      try {
        optimized = await optimizer.plugin.optimize({
          bundle,
          contents: optimized.contents,
          map: optimized.map,
          options: this.pluginOptions,
          logger: new PluginLogger({origin: optimizer.name}),
        });
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, optimizer.name),
        });
      }
    }

    return optimized;
  }

  generateSourceMap(bundle: InternalBundle, map: SourceMap): Promise<string> {
    // sourceRoot should be a relative path between outDir and rootDir for node.js targets
    let filePath = nullthrows(bundle.filePath);
    let sourceRoot: string = path.relative(
      path.dirname(filePath),
      this.options.projectRoot,
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
        (bundle.target.sourceMap && bundle.target.sourceMap.inline),
    });
  }

  getCacheKey(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
  ): string {
    let filePath = nullthrows(bundle.filePath);
    // TODO: include packagers and optimizers used in inline bundles as well
    let packager = this.config.getPackagerName(filePath);
    let optimizers = this.config.getOptimizerNames(filePath);
    let deps = Promise.all(
      [packager, ...optimizers].map(async pkg => {
        let {pkg: resolvedPkg} = await this.options.packageManager.resolve(
          `${pkg}/package.json`,
          `${this.config.filePath}/index`,
        );

        let version = nullthrows(resolvedPkg).version;
        return [pkg, version];
      }),
    );

    // TODO: add third party configs to the cache key
    let {sourceMaps} = this.options;
    return md5FromObject({
      parcelVersion: PARCEL_VERSION,
      deps,
      opts: {sourceMaps},
      hash: bundleGraph.getContentHash(bundle), // TODO: this should consider inline bundles (and their loaded configs)
    });
  }

  async readFromCache(
    cacheKey: string,
  ): Promise<?{|
    contents: Readable,
    map: ?Readable,
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
      map: mapExists ? this.options.cache.getStream(mapKey) : null,
    };
  }

  async writeToDist({
    bundle,
    bundleGraph,
    info,
    hashRefToNameHash,
  }: {|
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    info: {|...BundleInfo, cacheKey: string|},
    hashRefToNameHash: Map<string, string>,
  |}) {
    let {inputFS, outputFS} = this.options;
    let filePath = nullthrows(bundle.filePath);
    let thisHashReference = bundle.hashReference;
    if (filePath.includes(thisHashReference)) {
      filePath = filePath.replace(
        thisHashReference,
        nullthrows(hashRefToNameHash.get(thisHashReference)),
      );
      bundle.filePath = filePath;
      bundle.name = nullthrows(bundle.name).replace(
        thisHashReference,
        nullthrows(hashRefToNameHash.get(thisHashReference)),
      );
    }

    let dir = path.dirname(filePath);
    await outputFS.mkdirp(dir); // ? Got rid of dist exists, is this an expensive operation

    // Use the file mode from the entry asset as the file mode for the bundle.
    // Don't do this for browser builds, as the executable bit in particular is unnecessary.
    let publicBundle = new NamedBundle(bundle, bundleGraph, this.options);
    let writeOptions = publicBundle.env.isBrowser()
      ? undefined
      : {
          mode: (
            await inputFS.stat(nullthrows(publicBundle.getMainEntry()).filePath)
          ).mode,
        };
    let cacheKey = info.cacheKey;
    let contentKey = getContentKey(cacheKey);
    let contentStream = this.options.cache.getStream(contentKey);
    let size = await writeFileStream(
      outputFS,
      filePath,
      contentStream,
      info.hashReferences,
      hashRefToNameHash,
      writeOptions,
    );
    bundle.stats = {
      size,
      time: info.time,
    };

    let mapKey = getMapKey(cacheKey);
    if (await this.options.cache.blobExists(mapKey)) {
      let mapStream = this.options.cache.getStream(mapKey);
      await writeFileStream(
        outputFS,
        filePath + '.map',
        mapStream,
        info.hashReferences,
        hashRefToNameHash,
      );
    }
  }

  async writeToCache(cacheKey: string, contents: Blob, map: ?Blob) {
    let contentKey = getContentKey(cacheKey);

    let size = 0;
    let hash = crypto.createHash('md5');
    let prevBuf = '';
    let hashReferences = [];
    await this.options.cache.setStream(
      contentKey,
      blobToStream(contents).pipe(
        new TapStream(buf => {
          let str = prevBuf.toString() + buf.toString();
          hashReferences = hashReferences.concat(
            [...str.matchAll(/@@HASH_REFERENCE_\w{8}/g)].map(match => match[0]),
          );
          size += buf.length;
          hash.update(buf);
          prevBuf = buf;
        }),
      ),
    );

    if (map != null) {
      let mapKey = getMapKey(cacheKey);
      await this.options.cache.setStream(mapKey, blobToStream(map));
    }

    let info = {size, hash: hash.digest('hex'), hashReferences};
    await this.options.cache.set(getInfoKey(cacheKey), JSON.stringify(info));
    return info;
  }
}

async function writeFileStream(
  fs: FileSystem,
  filePath: FilePath,
  stream: Readable,
  hashReferences: Array<string>,
  hashRefToNameHash: Map<string, string>,
  options: ?FileOptions,
): Promise<number> {
  // TODO: stream directly to filesystem instead of to string first
  //  - need to figure out how to replace hash references in a stream
  let bundleStr = '';
  await new Promise(resolve => {
    stream.on('data', buf => {
      bundleStr += buf.toString();
    });
    stream.on('end', () => {
      resolve();
    });
  });

  for (let hashRef of hashReferences) {
    let re = new RegExp(hashRef, 'g');
    bundleStr = bundleStr.replace(
      re,
      nullthrows(hashRefToNameHash.get(hashRef)),
    );
  }

  await fs.writeFile(filePath, bundleStr, options);

  return bundleStr.length;

  // return new Promise((resolve, reject) => {
  //   let fsStream = fs.createWriteStream(filePath, options);
  //   stream
  //     .pipe(fsStream)
  //     // $FlowFixMe
  //     .on('finish', () => resolve(fsStream.bytesWritten))
  //     .on('error', reject);
  // });
}

function getContentKey(cacheKey: string) {
  return md5FromString(`${cacheKey}:content`);
}

function getMapKey(cacheKey: string) {
  return md5FromString(`${cacheKey}:map`);
}

function getInfoKey(cacheKey: string) {
  return md5FromString(`${cacheKey}:info`);
}

function generateHashRefToNameHashMap(
  bundles,
  bundleInfoMap,
  hashRefToId,
): Map<string, string> {
  let refHashToNameHashMap = new Map();

  for (let bundle of bundles) {
    let includedBundles = getBundlesIncludedInHash(
      bundle.id,
      bundleInfoMap,
      hashRefToId,
    );
    // TODO: probably don't need to hash if only one bundle is included, just use that hash?
    refHashToNameHashMap.set(
      bundle.hashReference,
      md5FromString(
        [...includedBundles]
          .map(bundleId => bundleInfoMap[bundleId].hash)
          .join(':'),
      ).slice(-8),
    );
  }

  return refHashToNameHashMap;
}

function getBundlesIncludedInHash(
  bundleId,
  bundleInfoMap,
  hashRefToId,
  included = new Set(),
) {
  included.add(bundleId);
  for (let hashRef of bundleInfoMap[bundleId].hashReferences) {
    let referencedId = hashRefToId[hashRef];
    if (!included.has(referencedId)) {
      for (let ref in getBundlesIncludedInHash(
        referencedId,
        bundleInfoMap,
        hashRefToId,
        included,
      )) {
        included.add(ref);
      }
    }
  }

  return included;
}
