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
import {blobToStream, TapStream} from '@parcel/utils';
import {PluginLogger} from '@parcel/logger';
import {init as initSourcemaps} from '@parcel/source-map';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import {Readable, Transform} from 'stream';
import nullthrows from 'nullthrows';
import path from 'path';
import url from 'url';
import {hashString, hashBuffer, Hash} from '@parcel/hash';

import {NamedBundle, bundleToInternalBundle} from './public/Bundle';
import BundleGraph, {
  bundleGraphToInternalBundleGraph,
} from './public/BundleGraph';
import PluginOptions from './public/PluginOptions';
import {PARCEL_VERSION, HASH_REF_PREFIX, HASH_REF_REGEX} from './constants';
import {serialize} from './serializer';

type Opts = {|
  config: ParcelConfig,
  options: ParcelOptions,
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
  options: ParcelOptions;
  pluginOptions: PluginOptions;
  distDir: FilePath;
  distExists: Set<FilePath>;
  report: ReportFn;

  constructor({config, options, report}: Opts) {
    this.config = config;
    this.options = options;
    this.pluginOptions = new PluginOptions(this.options);
    this.report = report;
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

    let {plugin} = await this.config.getPackager(nullthrows(bundle.name));
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
        return path.basename(bundle.name) + '.map';
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

    let {name, plugin} = await this.config.getPackager(bundle.name);
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
          filePath: path.join(bundle.target.distDir, bundle.name),
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
      bundle.name,
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
            filePath: path.join(bundle.target.distDir, bundle.name),
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
    let filePath = path.join(bundle.target.distDir, nullthrows(bundle.name));
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
    let name = nullthrows(bundle.name);
    // TODO: include packagers and optimizers used in inline bundles as well
    let {version: packager} = await this.config.getPackager(name);
    let optimizers = (await this.config.getOptimizers(name))
      .map(({name, version}) => name + version)
      .join('');

    let configResults = {};
    for (let [id, config] of configs) {
      configResults[id] = config?.config;
    }

    // TODO: add third party configs to the cache key
    let {publicUrl} = bundle.target;
    return hashString(
      PARCEL_VERSION +
        packager +
        optimizers +
        publicUrl +
        bundleGraph.getHash(bundle) +
        JSON.stringify(configResults),
    );
  }

  async readFromCache(
    cacheKey: string,
  ): Promise<?{|
    contents: Readable,
    map: ?Readable,
  |}> {
    let contentKey = PackagerRunner.getContentKey(cacheKey);
    let mapKey = PackagerRunner.getMapKey(cacheKey);

    let contentExists = await this.options.cache.has(contentKey);
    if (!contentExists) {
      return null;
    }

    let mapExists = await this.options.cache.has(mapKey);

    return {
      contents: this.options.cache.getStream(contentKey),
      map: mapExists ? this.options.cache.getStream(mapKey) : null,
    };
  }

  async writeToCache(
    cacheKeys: CacheKeyMap,
    type: string,
    contents: Blob,
    map: ?string,
  ): Promise<BundleInfo> {
    let size = 0;
    let hash;
    let hashReferences = [];

    // TODO: don't replace hash references in binary files??
    if (contents instanceof Readable) {
      let boundaryStr = '';
      let h = new Hash();
      await this.options.cache.setStream(
        cacheKeys.content,
        blobToStream(contents).pipe(
          new TapStream(buf => {
            let str = boundaryStr + buf.toString();
            hashReferences = hashReferences.concat(
              str.match(HASH_REF_REGEX) ?? [],
            );
            size += buf.length;
            h.writeBuffer(buf);
            boundaryStr = str.slice(str.length - BOUNDARY_LENGTH);
          }),
        ),
      );
      hash = h.finish();
    } else if (typeof contents === 'string') {
      size = Buffer.byteLength(contents);
      hash = hashString(contents);
      hashReferences = contents.match(HASH_REF_REGEX) ?? [];
      await this.options.cache.setBlob(cacheKeys.content, contents);
    } else {
      size = contents.length;
      hash = hashBuffer(contents);
      hashReferences = contents.toString().match(HASH_REF_REGEX) ?? [];
      await this.options.cache.setBlob(cacheKeys.content, contents);
    }

    if (map != null) {
      await this.options.cache.setBlob(cacheKeys.map, map);
    }
    let info = {
      type,
      size,
      hash,
      hashReferences,
      cacheKeys,
    };
    await this.options.cache.set(cacheKeys.info, info);
    return info;
  }

  static getContentKey(cacheKey: string): string {
    return hashString(`${cacheKey}:content`);
  }

  static getMapKey(cacheKey: string): string {
    return hashString(`${cacheKey}:map`);
  }

  static getInfoKey(cacheKey: string): string {
    return hashString(`${cacheKey}:info`);
  }
}
