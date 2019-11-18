// @flow strict-local

import type {
  AST,
  ASTGenerator,
  Blob,
  ConfigResult,
  DependencyOptions,
  File,
  FilePath,
  Meta,
  PackageJSON,
  PackageName,
  Stats,
  Symbol,
  Transformer,
  TransformerResult
} from '@parcel/types';
import type {Asset, Dependency, Environment, ParcelOptions} from './types';

import {Readable} from 'stream';
import crypto from 'crypto';
import SourceMap from '@parcel/source-map';
import {
  bufferStream,
  loadConfig,
  md5FromString,
  blobToStream,
  TapStream
} from '@parcel/utils';
import nullthrows from 'nullthrows';
import {createDependency, mergeDependencies} from './Dependency';
import {mergeEnvironments, getEnvironmentHash} from './Environment';
import {PARCEL_VERSION} from './constants';
import loadPlugin from './loadParcelPlugin';
import PluginOptions from './public/PluginOptions';
import {Asset as PublicAsset} from './public/Asset';
import {PluginLogger} from '@parcel/logger';

type AssetOptions = {|
  id?: string,
  hash?: ?string,
  idBase?: ?string,
  filePath: FilePath,
  type: string,
  contentKey?: ?string,
  mapKey?: ?string,
  astKey?: ?string,
  astGenerator?: ?ASTGenerator,
  dependencies?: Map<string, Dependency>,
  includedFiles?: Map<FilePath, File>,
  isIsolated?: boolean,
  isInline?: boolean,
  isSource: boolean,
  env: Environment,
  meta?: Meta,
  pipeline?: ?string,
  stats: Stats,
  symbols?: Map<Symbol, Symbol>,
  sideEffects?: boolean,
  uniqueKey?: ?string,
  plugin?: PackageName
|};

export function createAsset(options: AssetOptions): Asset {
  let idBase = options.idBase != null ? options.idBase : options.filePath;
  let uniqueKey = options.uniqueKey || '';
  return {
    id:
      options.id != null
        ? options.id
        : md5FromString(
            idBase + options.type + getEnvironmentHash(options.env) + uniqueKey
          ),
    hash: options.hash,
    filePath: options.filePath,
    isIsolated: options.isIsolated == null ? false : options.isIsolated,
    isInline: options.isInline == null ? false : options.isInline,
    type: options.type,
    contentKey: options.contentKey,
    mapKey: options.mapKey,
    astKey: options.astKey,
    astGenerator: options.astGenerator,
    dependencies: options.dependencies || new Map(),
    includedFiles: options.includedFiles || new Map(),
    isSource: options.isSource,
    pipeline: options.pipeline,
    env: options.env,
    meta: options.meta || {},
    stats: options.stats,
    symbols: options.symbols || new Map(),
    sideEffects: options.sideEffects != null ? options.sideEffects : true,
    uniqueKey: uniqueKey,
    plugin: options.plugin
  };
}

type InternalAssetOptions = {|
  value: Asset,
  options: ParcelOptions,
  content?: Blob,
  map?: ?SourceMap,
  ast?: ?AST,
  isASTDirty?: ?boolean,
  idBase?: ?string
|};

export default class InternalAsset {
  value: Asset;
  options: ParcelOptions;
  content: ?Blob;
  map: ?SourceMap;
  ast: ?AST;
  isASTDirty: boolean;
  idBase: ?string;
  isGenerating: boolean;

  constructor({
    value,
    options,
    content,
    map,
    ast,
    isASTDirty,
    idBase
  }: InternalAssetOptions) {
    this.value = value;
    this.options = options;
    this.content = content;
    this.map = map;
    this.ast = ast;
    this.isASTDirty = isASTDirty || false;
    this.idBase = idBase;
    this.isGenerating = false;
  }

  /*
   * Prepares the asset for being serialized to the cache by commiting its
   * content and map of the asset to the cache.
   */
  async commit(pipelineKey: string): Promise<void> {
    let contentStream = this.getStream();
    if (
      // $FlowFixMe
      typeof contentStream.bytesRead === 'number' &&
      contentStream.bytesRead > 0
    ) {
      throw new Error(
        'Stream has already been read. This may happen if a plugin reads from a stream and does not replace it.'
      );
    }

    let size = 0;
    let hash = crypto.createHash('md5');

    // Since we can only read from the stream once, compute the content length
    // and hash while it's being written to the cache.
    let [contentKey, mapKey, astKey] = await Promise.all([
      this.ast != null
        ? Promise.resolve()
        : this.options.cache.setStream(
            this.getCacheKey('content' + pipelineKey),
            contentStream.pipe(
              new TapStream(buf => {
                size += buf.length;
                hash.update(buf);
              })
            )
          ),
      this.map == null || this.ast != null
        ? Promise.resolve()
        : this.options.cache.set(
            this.getCacheKey('map' + pipelineKey),
            this.map
          ),
      this.ast == null
        ? Promise.resolve()
        : this.options.cache.set(
            this.getCacheKey('ast' + pipelineKey),
            this.ast
          )
    ]);
    this.value.contentKey = contentKey;
    this.value.mapKey = mapKey;
    this.value.astKey = astKey;

    // TODO: how should we set the size when we only store an AST?
    if (contentKey != null) {
      this.value.stats.size = size;
    }
  }

  async generateFromAST() {
    if (this.isGenerating) {
      throw new Error('Cannot call asset.getCode() from while generating');
    }

    this.isGenerating = true;

    let ast = await this.getAST();
    if (ast == null) {
      throw new Error('Asset has no AST');
    }

    // TODO: where should we really load relative to??
    let pluginName = nullthrows(this.value.plugin);
    let plugin: Transformer = await loadPlugin(
      this.options.packageManager,
      pluginName,
      __dirname
    );
    if (!plugin.generate) {
      throw new Error(`${pluginName} does not have a generate method`);
    }

    let {code, map} = await plugin.generate({
      asset: new PublicAsset(this),
      ast,
      options: new PluginOptions(this.options),
      logger: new PluginLogger({origin: pluginName})
    });

    // TODO: store this in the cache for next time
    this.content = code;
    this.map = map;
    this.isGenerating = false;
  }

  async getCode(): Promise<string> {
    if (this.content == null && this.value.astKey != null) {
      await this.generateFromAST();
    }

    if (this.value.contentKey != null && this.content == null) {
      this.content = this.options.cache.getStream(this.value.contentKey);
    }

    if (typeof this.content === 'string' || this.content instanceof Buffer) {
      this.content = this.content.toString();
    } else if (this.content != null) {
      this.content = (await bufferStream(this.content)).toString();
    } else {
      this.content = '';
    }

    return this.content;
  }

  async getBuffer(): Promise<Buffer> {
    if (this.value.contentKey != null && this.content == null) {
      this.content = this.options.cache.getStream(this.value.contentKey);
    }

    if (this.content == null) {
      return Buffer.alloc(0);
    } else if (
      typeof this.content === 'string' ||
      this.content instanceof Buffer
    ) {
      return Buffer.from(this.content);
    }

    this.content = await bufferStream(this.content);
    return this.content;
  }

  getStream(): Readable {
    if (this.value.contentKey != null && this.content == null) {
      this.content = this.options.cache.getStream(this.value.contentKey);
    }

    return blobToStream(this.content != null ? this.content : Buffer.alloc(0));
  }

  setCode(code: string) {
    this.content = code;
    this.clearAST();
  }

  setBuffer(buffer: Buffer) {
    this.content = buffer;
    this.clearAST();
  }

  setStream(stream: Readable) {
    this.content = stream;
    this.clearAST();
  }

  async getMap(): Promise<?SourceMap> {
    // TODO: also generate from AST here??

    if (this.value.mapKey != null && this.map == null) {
      this.map = await this.options.cache.get(this.value.mapKey);
    }

    return this.map;
  }

  setMap(map: ?SourceMap): void {
    this.map = map;
  }

  async getAST(): Promise<?AST> {
    if (this.value.astKey != null) {
      this.ast = await this.options.cache.get(this.value.astKey);
    }

    return this.ast;
  }

  setAST(ast: AST): void {
    this.ast = ast;
    this.isASTDirty = true;
    this.value.astGenerator = {
      type: ast.type,
      version: ast.version
    };

    this.content = null;
    this.map = null;
  }

  clearAST() {
    this.ast = null;
    this.isASTDirty = false;
    this.value.astGenerator = null;
  }

  getCacheKey(key: string): string {
    return md5FromString(
      PARCEL_VERSION + key + this.value.id + (this.value.hash || '')
    );
  }

  addDependency(opts: DependencyOptions) {
    // eslint-disable-next-line no-unused-vars
    let {env, target, ...rest} = opts;
    let dep = createDependency({
      ...rest,
      env: mergeEnvironments(this.value.env, env),
      sourceAssetId: this.value.id,
      sourcePath: this.value.filePath
    });
    let existing = this.value.dependencies.get(dep.id);
    if (existing) {
      mergeDependencies(existing, dep);
    } else {
      this.value.dependencies.set(dep.id, dep);
    }
    return dep.id;
  }

  addIncludedFile(file: File) {
    this.value.includedFiles.set(file.filePath, file);
  }

  getIncludedFiles(): Array<File> {
    return Array.from(this.value.includedFiles.values());
  }

  getDependencies(): Array<Dependency> {
    return Array.from(this.value.dependencies.values());
  }

  createChildAsset(
    result: TransformerResult,
    plugin: PackageName
  ): InternalAsset {
    let content = result.content ?? result.code ?? '';

    let asset = new InternalAsset({
      value: createAsset({
        idBase: this.idBase,
        hash: this.value.hash,
        filePath: this.value.filePath,
        type: result.type,
        isIsolated: result.isIsolated ?? this.value.isIsolated,
        isInline: result.isInline ?? this.value.isInline,
        isSource: result.isSource ?? this.value.isSource,
        env: mergeEnvironments(this.value.env, result.env),
        dependencies:
          this.value.type === result.type
            ? new Map(this.value.dependencies)
            : new Map(),
        includedFiles: new Map(this.value.includedFiles),
        meta: {
          ...this.value.meta,
          // $FlowFixMe
          ...result.meta
        },
        pipeline:
          result.pipeline ??
          (this.value.type === result.type ? this.value.pipeline : null),
        stats: {
          time: 0,
          size: this.value.stats.size
        },
        symbols: new Map([...this.value.symbols, ...(result.symbols || [])]),
        sideEffects: result.sideEffects ?? this.value.sideEffects,
        uniqueKey: result.uniqueKey,
        astGenerator: result.ast
          ? {type: result.ast.type, version: result.ast.version}
          : null,
        plugin
      }),
      options: this.options,
      content,
      ast: result.ast,
      isASTDirty: result.ast === this.ast ? this.isASTDirty : true,
      map: result.map,
      idBase: this.idBase
    });

    let dependencies = result.dependencies;
    if (dependencies) {
      for (let dep of dependencies) {
        asset.addDependency(dep);
      }
    }

    let includedFiles = result.includedFiles;
    if (includedFiles) {
      for (let file of includedFiles) {
        asset.addIncludedFile(file);
      }
    }

    return asset;
  }

  async getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean
    |}
  ): Promise<ConfigResult | null> {
    let packageKey = options?.packageKey;
    let parse = options && options.parse;

    if (packageKey != null) {
      let pkg = await this.getPackage();
      if (pkg && pkg[packageKey]) {
        return pkg[packageKey];
      }
    }

    let conf = await loadConfig(
      this.options.inputFS,
      this.value.filePath,
      filePaths,
      parse == null ? null : {parse}
    );
    if (!conf) {
      return null;
    }

    for (let file of conf.files) {
      this.addIncludedFile(file);
    }

    return conf.config;
  }

  getPackage(): Promise<PackageJSON | null> {
    return this.getConfig(['package.json']);
  }
}
