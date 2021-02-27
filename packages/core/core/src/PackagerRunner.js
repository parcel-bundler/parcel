// @flow strict-local

import type {
  Blob,
  FilePath,
  BundleResult,
  Bundle as BundleType,
  BundleGraph as BundleGraphType,
  NamedBundle as NamedBundleType,
  Async,
  ConfigOutput,
} from '@parcel/types';
import type SourceMap from '@parcel/source-map';
import type WorkerFarm, {SharedReference} from '@parcel/workers';
import type {Bundle as InternalBundle, ParcelOptions, ReportFn} from './types';
import type ParcelConfig from './ParcelConfig';
import type InternalBundleGraph from './BundleGraph';
import type {FileSystem, FileOptions} from '@parcel/fs';

import invariant from 'assert';
import {
  md5FromOrderedObject,
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
import {PARCEL_VERSION, HASH_REF_PREFIX, HASH_REF_REGEX} from './constants';

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
  +cacheKeys: CacheKeyMap,
|};

type CacheKeyMap = {|
  content: string,
  map: string,
  info: string,
|};

const BOUNDARY_LENGTH = HASH_REF_PREFIX.length + 32 - 1;

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

  async writeBundles(
    bundleGraph: InternalBundleGraph,
    serializedBundleGraph: Buffer,
  ) {
    let farm = nullthrows(this.farm);
    let {ref, dispose} = await farm.createSharedReference(
      bundleGraph,
      serializedBundleGraph,
    );

    let bundleInfoMap: {|
      [string]: {|
        ...BundleInfo,
        cacheKeys: CacheKeyMap,
      |},
    |} = {};
    let writeEarlyPromises = {};
    let hashRefToNameHash = new Map();
    let bundles = bundleGraph.getBundles().filter(bundle => {
      // Do not package and write placeholder bundles to disk. We just
      // need to update the name so other bundles can reference it.
      if (bundle.isPlaceholder) {
        let hash = bundle.id.slice(-8);
        hashRefToNameHash.set(bundle.hashReference, hash);
        bundle.filePath = nullthrows(bundle.filePath).replace(
          bundle.hashReference,
          hash,
        );
        bundle.name = nullthrows(bundle.name).replace(
          bundle.hashReference,
          hash,
        );
        return false;
      }

      // skip inline bundles, they will be processed via the parent bundle
      return !bundle.isInline;
    });

    try {
      await Promise.all(
        bundles.map(async bundle => {
          let info = await this.processBundle(bundle, bundleGraph, ref);
          bundleInfoMap[bundle.id] = info;
          if (!info.hashReferences.length) {
            hashRefToNameHash.set(
              bundle.hashReference,
              this.options.shouldContentHash
                ? info.hash.slice(-8)
                : bundle.id.slice(-8),
            );
            writeEarlyPromises[bundle.id] = this.writeToDist({
              bundle,
              info,
              hashRefToNameHash,
              bundleGraph,
            });
          }
        }),
      );
      assignComplexNameHashes(
        hashRefToNameHash,
        bundles,
        bundleInfoMap,
        this.options,
      );
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
    } finally {
      await dispose();
    }
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

    return {
      ...(await this.getBundleInfoFromWorker({
        bundle,
        bundleGraphReference,
        optionsRef: nullthrows(this.optionsRef),
        configRef: nullthrows(this.configRef),
      })),
      time: Date.now() - start,
    };
  }

  async loadConfigs(
    bundleGraph: InternalBundleGraph,
    bundle: InternalBundle,
  ): Promise<Map<string, ?ConfigOutput>> {
    let configs = new Map();

    configs.set(bundle.id, await this.loadConfig(bundleGraph, bundle));
    for (let inlineBundle of bundleGraph.getInlineBundles(bundle)) {
      configs.set(
        inlineBundle.id,
        await this.loadConfig(bundleGraph, inlineBundle),
      );
    }

    return configs;
  }

  async loadConfig(
    bundleGraph: InternalBundleGraph,
    bundle: InternalBundle,
  ): Promise<?ConfigOutput> {
    let config: ?ConfigOutput;

    let {plugin} = await this.config.getPackager(nullthrows(bundle.filePath));
    if (plugin.loadConfig != null) {
      try {
        config = await nullthrows(plugin.loadConfig)({
          bundle: NamedBundle.get(bundle, bundleGraph, this.options),
          options: this.pluginOptions,
          logger: new PluginLogger({origin: this.config.getBundlerName()}),
        });
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, {
            origin: this.config.getBundlerName(),
            filePath: bundle.filePath,
          }),
        });
      }
    }

    return config;
  }

  getBundleInfoFromCache(infoKey: string): Async<?BundleInfo> {
    if (this.options.shouldDisableCache) {
      return;
    }

    return this.options.cache.get<BundleInfo>(infoKey);
  }

  async getBundleInfo(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    cacheKeys: CacheKeyMap,
    configs: Map<string, ?ConfigOutput>,
  ): Promise<BundleInfo> {
    let {type, contents, map} = await this.getBundleResult(
      bundle,
      bundleGraph,
      configs,
    );

    return this.writeToCache(cacheKeys, type, contents, map);
  }

  async getBundleResult(
    bundle: InternalBundle,
    bundleGraph: InternalBundleGraph,
    configs: Map<string, ?ConfigOutput>,
  ): Promise<{|
    type: string,
    contents: Blob,
    map: ?string,
  |}> {
    await initSourcemaps;

    let packaged = await this.package(bundle, bundleGraph, configs);
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
    if (map && bundle.env.sourceMap && !bundle.isInline) {
      if (bundle.env.sourceMap && bundle.env.sourceMap.inline) {
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
    configs: Map<string, ?ConfigOutput>,
  ): Promise<BundleResult> {
    let bundle = NamedBundle.get(internalBundle, bundleGraph, this.options);
    this.report({
      type: 'buildProgress',
      phase: 'packaging',
      bundle,
    });

    let {name, plugin} = await this.config.getPackager(bundle.filePath);
    try {
      return await plugin.package({
        config: configs.get(bundle.id)?.config,
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
        logger: new PluginLogger({origin: name}),
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
            configs,
          );

          return {contents: res.contents};
        },
      });
    } catch (e) {
      throw new ThrowableDiagnostic({
        diagnostic: errorToDiagnostic(e, {
          origin: name,
          filePath: bundle.filePath,
        }),
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
          diagnostic: errorToDiagnostic(e, {
            origin: optimizer.name,
            filePath: bundle.filePath,
          }),
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
        bundle.env.sourceMap &&
        bundle.env.sourceMap.sourceRoot !== undefined
      ) {
        sourceRoot = bundle.env.sourceMap.sourceRoot;
      } else if (
        this.options.serveOptions &&
        bundle.target.env.context === 'browser'
      ) {
        sourceRoot = '/__parcel_source_root';
      }

      if (
        bundle.env.sourceMap &&
        bundle.env.sourceMap.inlineSources !== undefined
      ) {
        inlineSources = bundle.env.sourceMap.inlineSources;
      } else if (bundle.target.env.context !== 'node') {
        // inlining should only happen in production for browser targets by default
        inlineSources = this.options.mode === 'production';
      }
    }

    let mapFilename = filePath + '.map';
    let isInlineMap = bundle.env.sourceMap && bundle.env.sourceMap.inline;

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
    configs: Map<string, ?ConfigOutput>,
  ): Promise<string> {
    let filePath = nullthrows(bundle.filePath);
    // TODO: include packagers and optimizers used in inline bundles as well
    let {version: packager} = await this.config.getPackager(filePath);
    let optimizers = (
      await this.config.getOptimizers(filePath)
    ).map(({name, version}) => [name, version]);

    let configResults = {};
    for (let [id, config] of configs) {
      configResults[id] = config?.config;
    }

    // TODO: add third party configs to the cache key
    let {publicUrl} = bundle.target;
    return md5FromOrderedObject({
      parcelVersion: PARCEL_VERSION,
      packager,
      optimizers,
      target: {publicUrl},
      hash: bundleGraph.getHash(bundle),
      configResults,
    });
  }

  async readFromCache(
    cacheKey: string,
  ): Promise<?{|
    contents: Readable,
    map: ?Readable,
  |}> {
    let contentKey = PackagerRunner.getContentKey(cacheKey);
    let mapKey = PackagerRunner.getMapKey(cacheKey);

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

    if (filePath.includes(thisHashReference)) {
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
      info.hashReferences,
      hashRefToNameHash,
      writeOptions,
    );
    bundle.stats = {
      size,
      time: info.time ?? 0,
    };

    let mapKey = cacheKeys.map;
    if (
      bundle.env.sourceMap &&
      !bundle.env.sourceMap.inline &&
      (await this.options.cache.blobExists(mapKey))
    ) {
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

  async writeToCache(
    cacheKeys: CacheKeyMap,
    type: string,
    contents: Blob,
    map: ?Blob,
  ): Promise<BundleInfo> {
    let size = 0;
    let hash = crypto.createHash('md5');
    let boundaryStr = '';
    let hashReferences = [];
    await this.options.cache.setStream(
      cacheKeys.content,
      blobToStream(contents).pipe(
        new TapStream(buf => {
          let str = boundaryStr + buf.toString();
          hashReferences = hashReferences.concat(
            str.match(HASH_REF_REGEX) ?? [],
          );
          size += buf.length;
          hash.update(buf);
          boundaryStr = str.slice(str.length - BOUNDARY_LENGTH);
        }),
      ),
    );

    if (map != null) {
      await this.options.cache.setStream(cacheKeys.map, blobToStream(map));
    }
    let info = {
      type,
      size,
      hash: hash.digest('hex'),
      hashReferences,
      cacheKeys,
    };
    await this.options.cache.set(cacheKeys.info, info);
    return info;
  }

  static getContentKey(cacheKey: string): string {
    return md5FromString(`${cacheKey}:content`);
  }

  static getMapKey(cacheKey: string): string {
    return md5FromString(`${cacheKey}:map`);
  }

  static getInfoKey(cacheKey: string): string {
    return md5FromString(`${cacheKey}:info`);
  }
}

function writeFileStream(
  fs: FileSystem,
  filePath: FilePath,
  stream: Readable,
  hashReferences: Array<string>,
  hashRefToNameHash: Map<string, string>,
  options: ?FileOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let initialStream = hashReferences.length
      ? stream.pipe(replaceStream(hashRefToNameHash))
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

function replaceStream(hashRefToNameHash) {
  let boundaryStr = '';
  return new Transform({
    transform(chunk, encoding, cb) {
      let str = boundaryStr + chunk.toString();
      let replaced = str.replace(HASH_REF_REGEX, match => {
        return hashRefToNameHash.get(match) || match;
      });
      boundaryStr = replaced.slice(replaced.length - BOUNDARY_LENGTH);
      let strUpToBoundary = replaced.slice(
        0,
        replaced.length - BOUNDARY_LENGTH,
      );
      cb(null, strUpToBoundary);
    },

    flush(cb) {
      cb(null, boundaryStr);
    },
  });
}

function assignComplexNameHashes(
  hashRefToNameHash,
  bundles,
  bundleInfoMap,
  options,
) {
  for (let bundle of bundles) {
    if (hashRefToNameHash.get(bundle.hashReference) != null) {
      continue;
    }

    hashRefToNameHash.set(
      bundle.hashReference,
      options.shouldContentHash
        ? md5FromString(
            [...getBundlesIncludedInHash(bundle.id, bundleInfoMap)]
              .map(bundleId => bundleInfoMap[bundleId].hash)
              .join(':'),
          ).slice(-8)
        : bundle.id.slice(-8),
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
  return hashRef.slice(HASH_REF_PREFIX.length);
}
