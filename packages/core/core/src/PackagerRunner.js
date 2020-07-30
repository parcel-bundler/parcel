// @flow strict-local

import type {
  Blob,
  FilePath,
  BundleResult,
  Bundle as BundleType,
  BundleGraph as BundleGraphType,
  NamedBundle as NamedBundleType,
  Async,
} from '@parcel/types';
import type SourceMap from '@parcel/source-map';
import type WorkerFarm, {SharedReference} from '@parcel/workers';
import type {Bundle as InternalBundle, ParcelOptions, ReportFn} from './types';
import type ParcelConfig from './ParcelConfig';
import type InternalBundleGraph from './BundleGraph';
import type {FileSystem, FileOptions} from '@parcel/fs';

import invariant from 'assert';
import {
  md5FromObject,
  md5FromString,
  blobToStream,
  TapStream,
} from '@parcel/utils';
import {PluginLogger} from '@parcel/logger';
import {init as initSourcemaps} from '@parcel/source-map';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {Readable, Transform} from 'stream';
import nullthrows from 'nullthrows';
import path from 'path';
import url from 'url';
import crypto from 'crypto';

import {NamedBundle, bundleToInternalBundle} from './public/Bundle';
import BundleGraph, {
  bundleGraphToInternalBundleGraph,
} from './public/BundleGraph';
import PluginOptions from './public/PluginOptions';
import {
  PARCEL_VERSION,
  BUNDLE_HASH_REF_PREFIX,
  BUNDLE_HASH_REF_REGEX,
  ASSET_HASH_REF_REGEX,
} from './constants';

type Opts = {|
  config: ParcelConfig,
  configRef?: SharedReference,
  farm?: WorkerFarm,
  options: ParcelOptions,
  optionsRef?: SharedReference,
  report: ReportFn,
|};

export type BundleInfo = {|
  +type: string,
  +size: number,
  +hash: string,
  +hashReferences: Array<string>,
  +time?: number,
|};

type CacheKeyMap = {|
  content: string,
  map: string,
  info: string,
|};

const BOUNDARY_LENGTH = BUNDLE_HASH_REF_PREFIX.length + 32 - 1;

export default class PackagerRunner {
  config: ParcelConfig;
  configRef: ?SharedReference;
  options: ParcelOptions;
  optionsRef: ?SharedReference;
  farm: ?WorkerFarm;
  pluginOptions: PluginOptions;
  distDir: FilePath;
  distExists: Set<FilePath>;
  report: ReportFn;
  getBundleInfoFromWorker: ({|
    bundle: InternalBundle,
    bundleGraphReference: SharedReference,
    configRef: SharedReference,
    cacheKeys: CacheKeyMap,
    optionsRef: SharedReference,
  |}) => Promise<BundleInfo>;

  constructor({config, configRef, farm, options, optionsRef, report}: Opts) {
    this.config = config;
    this.configRef = configRef;
    this.options = options;
    this.optionsRef = optionsRef;
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
    let writeEarlyPromises = {};
    let hashRefToNameHash = new Map();
    // skip inline bundles, they will be processed via the parent bundle
    let bundles = bundleGraph.getBundles().filter(bundle => !bundle.isInline);
    await Promise.all(
      bundles.map(async bundle => {
        let info = await this.processBundle(bundle, bundleGraph, ref);
        bundleInfoMap[bundle.id] = info;
        if (!info.hashReferences.length) {
          hashRefToNameHash.set(bundle.hashReference, info.hash);
          writeEarlyPromises[bundle.id] = this.writeToDist({
            bundle,
            info,
            hashRefToNameHash,
            bundleGraph,
          });
        }
      }),
    );
    assignComplexNameHashes(hashRefToNameHash, bundles, bundleInfoMap);
    await Promise.all(
      bundles.map(
        bundle =>
          writeEarlyPromises[bundle.id] ??
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
    bundleGraphReference: SharedReference,
  ): Promise<{|
    ...BundleInfo,
    cacheKeys: CacheKeyMap,
  |}> {
    let start = Date.now();

    let cacheKey = await this.getCacheKey(bundle, bundleGraph);
    let cacheKeys = {
      content: getContentKey(cacheKey),
      map: getMapKey(cacheKey),
      info: getInfoKey(cacheKey),
    };
    let {type, size, hash, hashReferences} =
      (await this.getBundleInfoFromCache(cacheKeys.info)) ??
      (await this.getBundleInfoFromWorker({
        bundle,
        bundleGraphReference,
        cacheKeys,
        optionsRef: nullthrows(this.optionsRef),
        configRef: nullthrows(this.configRef),
      }));

    return {
      type,
      size,
      time: Date.now() - start,
      hash,
      hashReferences,
      cacheKeys,
    };
  }

  getBundleInfoFromCache(infoKey: string): Async<?BundleInfo> {
    if (this.options.disableCache) {
      return;
    }

    return this.options.cache.get<BundleInfo>(infoKey);
  }

  async getBundleInfo(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    cacheKeys: CacheKeyMap,
  ): Promise<BundleInfo> {
    let {type, contents, map} = await this.getBundleResult(bundle, bundleGraph);

    return this.writeToCache(cacheKeys, type, contents, map, bundleGraph);
  }

  async getBundleResult(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
  ): Promise<{|
    type: string,
    contents: Blob,
    map: ?string,
  |}> {
    await initSourcemaps;

    let packaged = await this.package(bundle, bundleGraph);
    let type = packaged.type ?? bundle.type;
    let res = await this.optimize(
      bundle,
      bundleGraph,
      type,
      packaged.contents,
      packaged.map,
    );

    let map =
      res.map != null ? await this.generateSourceMap(bundle, res.map) : null;
    return {
      type: res.type ?? type,
      contents: res.contents,
      map,
    };
  }

  getSourceMapReference(bundle: NamedBundle, map: ?SourceMap): Async<?string> {
    if (map && this.options.sourceMaps) {
      if (
        bundle.isInline ||
        (bundle.target.sourceMap && bundle.target.sourceMap.inline)
      ) {
        return this.generateSourceMap(bundleToInternalBundle(bundle), map);
      } else {
        return path.basename(bundle.filePath) + '.map';
      }
    } else {
      return null;
    }
  }

  async package(
    internalBundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
  ): Promise<BundleResult> {
    let bundle = NamedBundle.get(internalBundle, bundleGraph, this.options);
    this.report({
      type: 'buildProgress',
      phase: 'packaging',
      bundle,
    });

    let packager = await this.config.getPackager(bundle.filePath);
    try {
      return await packager.plugin.package({
        bundle,
        bundleGraph: new BundleGraph<NamedBundleType>(
          bundleGraph,
          NamedBundle.get,
          this.options,
        ),
        getSourceMapReference: map => {
          return this.getSourceMapReference(bundle, map);
        },
        options: this.pluginOptions,
        logger: new PluginLogger({origin: packager.name}),
        getInlineBundleContents: async (
          bundle: BundleType,
          bundleGraph: BundleGraphType<NamedBundleType>,
        ) => {
          if (!bundle.isInline) {
            throw new Error(
              'Bundle is not inline and unable to retrieve contents',
            );
          }

          let res = await this.getBundleResult(
            bundleToInternalBundle(bundle),
            // $FlowFixMe
            bundleGraphToInternalBundleGraph(bundleGraph),
          );

          return {contents: res.contents};
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
    internalBundleGraph: InternalBundleGraph,
    type: string,
    contents: Blob,
    map?: ?SourceMap,
  ): Promise<BundleResult> {
    let bundle = NamedBundle.get(
      internalBundle,
      internalBundleGraph,
      this.options,
    );
    let bundleGraph = new BundleGraph<NamedBundleType>(
      internalBundleGraph,
      NamedBundle.get,
      this.options,
    );
    let optimizers = await this.config.getOptimizers(
      bundle.filePath,
      internalBundle.pipeline,
    );
    if (!optimizers.length) {
      return {type: bundle.type, contents, map};
    }

    this.report({
      type: 'buildProgress',
      phase: 'optimizing',
      bundle,
    });

    let optimized = {
      type,
      contents,
      map,
    };

    for (let optimizer of optimizers) {
      try {
        let next = await optimizer.plugin.optimize({
          bundle,
          bundleGraph,
          contents: optimized.contents,
          map: optimized.map,
          getSourceMapReference: map => {
            return this.getSourceMapReference(bundle, map);
          },
          options: this.pluginOptions,
          logger: new PluginLogger({origin: optimizer.name}),
        });

        optimized.type = next.type ?? optimized.type;
        optimized.contents = next.contents;
        optimized.map = next.map;
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, optimizer.name),
        });
      }
    }

    return optimized;
  }

  async generateSourceMap(
    bundle: InternalBundle,
    map: SourceMap,
  ): Promise<string> {
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
        this.options.serve &&
        bundle.target.env.context === 'browser'
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
    let isInlineMap =
      bundle.isInline ||
      (bundle.target.sourceMap && bundle.target.sourceMap.inline);

    let stringified = await map.stringify({
      file: path.basename(mapFilename),
      // $FlowFixMe
      fs: this.options.inputFS,
      rootDir: this.options.projectRoot,
      sourceRoot: !inlineSources
        ? url.format(url.parse(sourceRoot + '/'))
        : undefined,
      inlineSources,
      format: isInlineMap ? 'inline' : 'string',
    });

    invariant(typeof stringified === 'string');
    return stringified;
  }

  async getCacheKey(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
  ): Promise<string> {
    let filePath = nullthrows(bundle.filePath);
    // TODO: include packagers and optimizers used in inline bundles as well
    let {version: packager} = await this.config.getPackager(filePath);
    let optimizers = (
      await this.config.getOptimizers(filePath)
    ).map(({name, version}) => [name, version]);

    // TODO: add third party configs to the cache key
    let {sourceMaps} = this.options;
    return md5FromObject({
      parcelVersion: PARCEL_VERSION,
      packager,
      optimizers,
      opts: {sourceMaps},
      hash: bundleGraph.getHash(bundle),
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
    info: {|...BundleInfo, cacheKeys: CacheKeyMap|},
    hashRefToNameHash: Map<string, string>,
  |}) {
    let {inputFS, outputFS} = this.options;
    let filePath = nullthrows(bundle.filePath);
    let name = nullthrows(bundle.name);
    let thisHashReference = bundle.hashReference;

    if (info.type !== bundle.type) {
      filePath =
        filePath.slice(0, -path.extname(filePath).length) + '.' + info.type;
      name = name.slice(0, -path.extname(name).length) + '.' + info.type;
      bundle.type = info.type;
    }

    // Without content hashing, the hash reference is already the correct id
    if (this.options.contentHash && filePath.includes(thisHashReference)) {
      let thisNameHash = nullthrows(hashRefToNameHash.get(thisHashReference));
      filePath = filePath.replace(thisHashReference, thisNameHash);
      name = name.replace(thisHashReference, thisNameHash);
    }

    bundle.filePath = filePath;
    bundle.name = name;

    let dir = path.dirname(filePath);
    await outputFS.mkdirp(dir); // ? Got rid of dist exists, is this an expensive operation

    // Use the file mode from the entry asset as the file mode for the bundle.
    // Don't do this for browser builds, as the executable bit in particular is unnecessary.
    let publicBundle = NamedBundle.get(bundle, bundleGraph, this.options);
    let mainEntry = publicBundle.getMainEntry();
    let writeOptions =
      publicBundle.env.isBrowser() || !mainEntry
        ? undefined
        : {
            mode: (await inputFS.stat(mainEntry.filePath)).mode,
          };
    let cacheKeys = info.cacheKeys;
    let contentStream = this.options.cache.getStream(cacheKeys.content);
    let size = await writeFileStream(
      outputFS,
      filePath,
      contentStream,
      info.hashReferences.length > 0,
      hashRefToNameHash,
      writeOptions,
    );
    bundle.stats = {
      size,
      time: info.time ?? 0,
    };

    let mapKey = cacheKeys.map;
    if (
      (typeof bundle.target.sourceMap === 'object'
        ? !bundle.target.sourceMap.inline
        : bundle.target.sourceMap) &&
      (await this.options.cache.blobExists(mapKey))
    ) {
      let mapStream = this.options.cache.getStream(mapKey);
      await writeFileStream(
        outputFS,
        filePath + '.map',
        mapStream,
        info.hashReferences.length > 0,
        hashRefToNameHash,
      );
    }
  }

  async writeToCache(
    cacheKeys: CacheKeyMap,
    type: string,
    contents: Blob,
    map: ?Blob,
    bundleGraph: InternalBundleGraph,
  ): Promise<BundleInfo> {
    let size = 0;
    let hash = crypto.createHash('md5');
    let boundaryStr = '';
    let hashReferences = [];
    await this.options.cache.setStream(
      cacheKeys.content,
      blobToStream(contents)
        .pipe(
          replaceStream(ASSET_HASH_REF_REGEX, match => {
            let id = getIdFromHashRef(match);
            if (bundleGraph.assetExists(id)) {
              return nullthrows(bundleGraph.getAssetById(id).contentHash);
            } else return match;
          }),
        )
        .pipe(
          new TapStream(buf => {
            let str = boundaryStr + buf.toString();
            hashReferences = hashReferences.concat(
              str.match(BUNDLE_HASH_REF_REGEX) ?? [],
            );
            size += buf.length;
            hash.update(buf);
            boundaryStr = str.slice(Math.max(0, str.length - BOUNDARY_LENGTH));
          }),
        ),
    );

    if (map != null) {
      await this.options.cache.setStream(cacheKeys.map, blobToStream(map));
    }
    let info = {type, size, hash: hash.digest('hex'), hashReferences};
    await this.options.cache.set(cacheKeys.info, info);
    return info;
  }
}

function writeFileStream(
  fs: FileSystem,
  filePath: FilePath,
  stream: Readable,
  hasHashReferences: boolean,
  hashRefToNameHash: Map<string, string>,
  options: ?FileOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let initialStream = hasHashReferences
      ? stream.pipe(
          replaceStream(
            BUNDLE_HASH_REF_REGEX,
            match => hashRefToNameHash.get(match) || match,
          ),
        )
      : stream;
    let fsStream = fs.createWriteStream(filePath, options);
    let fsStreamClosed = new Promise(resolve => {
      fsStream.on('close', () => resolve());
    });
    let bytesWritten = 0;
    initialStream
      .pipe(
        new TapStream(buf => {
          bytesWritten += buf.length;
        }),
      )
      .pipe(fsStream)
      .on('finish', () => resolve(fsStreamClosed.then(() => bytesWritten)))
      .on('error', reject);
  });
}

function replaceStream(pattern: RegExp, replacement: string => string) {
  let boundaryStr = '';
  return new Transform({
    transform(chunk, encoding, cb) {
      let str = boundaryStr + chunk.toString();
      let replaced = str.replace(pattern, match => {
        return replacement(match);
      });
      boundaryStr = replaced.slice(Math.max(0, str.length - BOUNDARY_LENGTH));
      let strUpToBoundary = replaced.slice(
        0,
        Math.max(0, str.length - BOUNDARY_LENGTH),
      );
      cb(null, strUpToBoundary);
    },

    flush(cb) {
      cb(null, boundaryStr);
    },
  });
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

function assignComplexNameHashes(hashRefToNameHash, bundles, bundleInfoMap) {
  for (let bundle of bundles) {
    if (hashRefToNameHash.get(bundle.hashReference) != null) {
      continue;
    }

    let includedBundles = [
      ...getBundlesIncludedInHash(bundle.id, bundleInfoMap),
    ];

    hashRefToNameHash.set(
      bundle.hashReference,
      md5FromString(
        includedBundles.map(bundleId => bundleInfoMap[bundleId].hash).join(':'),
      ),
    );
  }
}

function getBundlesIncludedInHash(
  bundleId,
  bundleInfoMap,
  included = new Set(),
) {
  included.add(bundleId);
  for (let hashRef of bundleInfoMap[bundleId].hashReferences) {
    let referencedId = getIdFromHashRef(hashRef);
    if (!included.has(referencedId)) {
      getBundlesIncludedInHash(referencedId, bundleInfoMap, included);
    }
  }

  return included;
}

function getIdFromHashRef(hashRef: string) {
  return hashRef.slice(BUNDLE_HASH_REF_PREFIX.length);
}
