// @flow strict-local

import type {
  AST,
  Blob,
  ConfigResult,
  DependencyOptions,
  File,
  FilePath,
  Meta,
  PackageJSON,
  Stats,
  Symbol,
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
import {createDependency, mergeDependencies} from './Dependency';
import {mergeEnvironments} from './Environment';
import {PARCEL_VERSION} from './constants';

type AssetOptions = {|
  id?: string,
  hash?: ?string,
  idBase?: ?string,
  filePath: FilePath,
  type: string,
  contentKey?: ?string,
  mapKey?: ?string,
  dependencies?: Map<string, Dependency>,
  includedFiles?: Map<FilePath, File>,
  isIsolated?: boolean,
  isInline?: boolean,
  isSource: boolean,
  outputHash?: string,
  env: Environment,
  meta?: Meta,
  stats: Stats,
  symbols?: Map<Symbol, Symbol>,
  sideEffects?: boolean,
  uniqueKey?: ?string
|};

export function createAsset(options: AssetOptions): Asset {
  let idBase = options.idBase != null ? options.idBase : options.filePath;
  let uniqueKey = options.uniqueKey || '';
  return {
    id:
      options.id != null
        ? options.id
        : md5FromString(
            idBase + options.type + JSON.stringify(options.env) + uniqueKey
          ),
    hash: options.hash,
    filePath: options.filePath,
    isIsolated: options.isIsolated == null ? false : options.isIsolated,
    isInline: options.isInline == null ? false : options.isInline,
    type: options.type,
    contentKey: options.contentKey,
    mapKey: options.mapKey,
    dependencies: options.dependencies || new Map(),
    includedFiles: options.includedFiles || new Map(),
    isSource: options.isSource,
    outputHash: options.outputHash || '',
    env: options.env,
    meta: options.meta || {},
    stats: options.stats,
    symbols: options.symbols || new Map(),
    sideEffects: options.sideEffects != null ? options.sideEffects : true,
    uniqueKey: uniqueKey
  };
}

type InternalAssetOptions = {|
  value: Asset,
  options: ParcelOptions,
  content?: Blob,
  map?: ?SourceMap,
  ast?: ?AST,
  idBase?: ?string
|};

export default class InternalAsset {
  value: Asset;
  options: ParcelOptions;
  content: Blob;
  map: ?SourceMap;
  ast: ?AST;
  idBase: ?string;

  constructor({
    value,
    options,
    content,
    map,
    ast,
    idBase
  }: InternalAssetOptions) {
    this.value = value;
    this.options = options;
    this.content = content || '';
    this.map = map;
    this.ast = ast;
    this.idBase = idBase;
  }

  /*
   * Prepares the asset for being serialized to the cache by commiting its
   * content and map of the asset to the cache.
   */
  async commit(pipelineKey: string): Promise<void> {
    this.ast = null;

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
    let [contentKey, mapKey] = await Promise.all([
      this.options.cache.setStream(
        this.getCacheKey('content' + pipelineKey),
        contentStream.pipe(
          new TapStream(buf => {
            size += buf.length;
            hash.update(buf);
          })
        )
      ),
      this.map == null
        ? Promise.resolve()
        : this.options.cache.set(
            this.getCacheKey('map' + pipelineKey),
            this.map
          )
    ]);
    this.value.contentKey = contentKey;
    this.value.mapKey = mapKey;
    this.value.stats.size = size;
    this.value.outputHash = hash.digest('hex');
  }

  async getCode(): Promise<string> {
    if (this.value.contentKey != null) {
      this.content = this.options.cache.getStream(this.value.contentKey);
    }

    if (typeof this.content === 'string' || this.content instanceof Buffer) {
      this.content = this.content.toString();
    } else {
      this.content = (await bufferStream(this.content)).toString();
    }

    return this.content;
  }

  async getBuffer(): Promise<Buffer> {
    if (this.value.contentKey != null) {
      this.content = this.options.cache.getStream(this.value.contentKey);
    }

    if (typeof this.content === 'string' || this.content instanceof Buffer) {
      return Buffer.from(this.content);
    }

    this.content = await bufferStream(this.content);
    return this.content;
  }

  getStream(): Readable {
    if (this.value.contentKey != null) {
      this.content = this.options.cache.getStream(this.value.contentKey);
    }

    return blobToStream(this.content);
  }

  setCode(code: string) {
    this.content = code;
  }

  setBuffer(buffer: Buffer) {
    this.content = buffer;
  }

  setStream(stream: Readable) {
    this.content = stream;
  }

  async getMap(): Promise<?SourceMap> {
    if (this.value.mapKey != null) {
      this.map = await this.options.cache.get(this.value.mapKey);
    }

    return this.map;
  }

  setMap(map: ?SourceMap): void {
    this.map = map;
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

  createChildAsset(result: TransformerResult): InternalAsset {
    let content = result.content ?? result.code ?? '';

    let hash;
    let size;
    if (content === this.content) {
      hash = this.value.hash;
      size = this.value.stats.size;
    } else if (typeof content === 'string' || content instanceof Buffer) {
      hash = md5FromString(content);
      size = content.length;
    } else {
      hash = null;
      size = NaN;
    }

    let asset = new InternalAsset({
      value: createAsset({
        idBase: this.idBase,
        hash,
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
        meta: {...this.value.meta, ...result.meta},
        stats: {
          time: 0,
          size
        },
        symbols: new Map([...this.value.symbols, ...(result.symbols || [])]),
        sideEffects: result.sideEffects ?? this.value.sideEffects,
        uniqueKey: result.uniqueKey
      }),
      options: this.options,
      content,
      ast: result.ast,
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
    options: ?{
      packageKey?: string,
      parse?: boolean,
      ...
    }
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
