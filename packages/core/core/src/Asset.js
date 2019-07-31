// @flow strict-local

import type Cache from '@parcel/cache';

import type {
  AST,
  Blob,
  Config,
  DependencyOptions,
  Environment,
  File,
  FilePath,
  Meta,
  PackageJSON,
  Stats,
  Symbol,
  TransformerResult
} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';

import {Readable} from 'stream';
import crypto from 'crypto';
import SourceMap from '@parcel/source-map';
import {
  bufferStream,
  loadConfig,
  md5FromFilePath,
  md5FromString,
  blobToStream,
  TapStream
} from '@parcel/utils';
import Dependency from './Dependency';

type AssetOptions = {|
  id?: string,
  hash?: ?string,
  idBase?: string,
  cache: Cache,
  fs: FileSystem,
  filePath: FilePath,
  type: string,
  content?: Blob,
  contentKey?: ?string,
  ast?: ?AST,
  map?: ?SourceMap,
  mapKey?: ?string,
  dependencies?: Map<string, Dependency>,
  connectedFiles?: Map<FilePath, File>,
  isIsolated?: boolean,
  outputHash?: string,
  env: Environment,
  meta?: Meta,
  stats: Stats,
  symbols?: Map<Symbol, Symbol>,
  sideEffects?: boolean
|};

export default class Asset {
  id: string;
  hash: ?string;
  idBase: string;
  fs: FileSystem;
  filePath: FilePath;
  type: string;
  ast: ?AST;
  cache: Cache;
  map: ?SourceMap;
  mapKey: ?string;
  dependencies: Map<string, Dependency>;
  connectedFiles: Map<FilePath, File>;
  isIsolated: boolean;
  outputHash: string;
  env: Environment;
  meta: Meta;
  stats: Stats;
  content: Blob;
  contentKey: ?string;
  symbols: Map<Symbol, Symbol>;
  sideEffects: boolean;

  constructor(options: AssetOptions) {
    this.idBase = options.idBase != null ? options.idBase : options.filePath;
    this.id =
      options.id != null
        ? options.id
        : md5FromString(
            this.idBase + options.type + JSON.stringify(options.env)
          );
    this.hash = options.hash;
    this.fs = options.fs;
    this.filePath = options.filePath;
    this.isIsolated = options.isIsolated == null ? false : options.isIsolated;
    this.type = options.type;
    this.content = options.content || '';
    this.contentKey = options.contentKey;
    this.ast = options.ast || null;
    this.cache = options.cache;
    this.map = options.map;
    this.mapKey = options.mapKey;
    this.dependencies = options.dependencies || new Map();
    this.connectedFiles = options.connectedFiles || new Map();
    this.outputHash = options.outputHash || '';
    this.env = options.env;
    this.meta = options.meta || {};
    this.stats = options.stats;
    this.symbols = options.symbols || new Map();
    this.sideEffects = options.sideEffects != null ? options.sideEffects : true;
  }

  static deserialize(opts: AssetOptions) {
    return new Asset(opts);
  }

  serialize(): AssetOptions {
    // Exclude `code`, `map`, and `ast` from cache
    return {
      id: this.id,
      hash: this.hash,
      fs: this.fs,
      filePath: this.filePath,
      cache: this.cache,
      type: this.type,
      dependencies: this.dependencies,
      connectedFiles: this.connectedFiles,
      isIsolated: this.isIsolated,
      outputHash: this.outputHash,
      env: this.env,
      meta: this.meta,
      stats: this.stats,
      contentKey: this.contentKey,
      mapKey: this.mapKey,
      symbols: this.symbols,
      sideEffects: this.sideEffects
    };
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
      this.cache.setStream(
        this.generateCacheKey('content' + pipelineKey),
        contentStream.pipe(
          new TapStream(buf => {
            size += buf.length;
            hash.update(buf);
          })
        )
      ),
      this.map == null
        ? Promise.resolve()
        : this.cache.set(this.generateCacheKey('map' + pipelineKey), this.map)
    ]);
    this.contentKey = contentKey;
    this.mapKey = mapKey;
    this.stats.size = size;
    this.outputHash = hash.digest('hex');
  }

  async getCode(): Promise<string> {
    if (this.contentKey != null) {
      this.content = this.cache.getStream(this.contentKey);
    }

    if (typeof this.content === 'string' || this.content instanceof Buffer) {
      this.content = this.content.toString();
    } else {
      this.content = (await bufferStream(this.content)).toString();
    }

    return this.content;
  }

  async getBuffer(): Promise<Buffer> {
    if (this.contentKey != null) {
      this.content = this.cache.getStream(this.contentKey);
    }

    if (typeof this.content === 'string' || this.content instanceof Buffer) {
      return Buffer.from(this.content);
    }

    this.content = await bufferStream(this.content);
    return this.content;
  }

  getStream(): Readable {
    if (this.contentKey != null) {
      this.content = this.cache.getStream(this.contentKey);
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
    if (this.mapKey != null) {
      this.map = await this.cache.get(this.mapKey);
    }

    return this.map;
  }

  setMap(map: ?SourceMap): void {
    this.map = map;
  }

  generateCacheKey(key: string): string {
    return md5FromString(key + this.id + JSON.stringify(this.env));
  }

  addDependency(opts: DependencyOptions) {
    let {env, ...rest} = opts;
    let dep = new Dependency({
      ...rest,
      env: this.env.merge(env),
      sourceAssetId: this.id,
      sourcePath: this.filePath
    });
    let existing = this.dependencies.get(dep.id);
    if (existing) {
      existing.merge(dep);
    } else {
      this.dependencies.set(dep.id, dep);
    }
    return dep.id;
  }

  async addConnectedFile(file: File) {
    if (file.hash == null) {
      file.hash = await md5FromFilePath(this.fs, file.filePath);
    }

    this.connectedFiles.set(file.filePath, file);
  }

  getConnectedFiles(): Array<File> {
    return Array.from(this.connectedFiles.values());
  }

  getDependencies(): Array<Dependency> {
    return Array.from(this.dependencies.values());
  }

  createChildAsset(result: TransformerResult): Asset {
    let content = result.content ?? result.code ?? '';

    let hash;
    let size;
    if (content === this.content) {
      hash = this.hash;
      size = this.stats.size;
    } else if (typeof content === 'string' || content instanceof Buffer) {
      hash = md5FromString(content);
      size = content.length;
    } else {
      hash = null;
      size = NaN;
    }

    let asset = new Asset({
      idBase: this.idBase,
      hash,
      fs: this.fs,
      filePath: this.filePath,
      type: result.type,
      content,
      cache: this.cache,
      ast: result.ast,
      map: result.map,
      isIsolated: result.isIsolated,
      env: this.env.merge(result.env),
      dependencies:
        this.type === result.type ? new Map(this.dependencies) : new Map(),
      connectedFiles: new Map(this.connectedFiles),
      meta: {...this.meta, ...result.meta},
      stats: {
        time: 0,
        size
      },
      symbols: new Map([...this.symbols, ...(result.symbols || [])]),
      sideEffects: result.sideEffects ?? this.sideEffects
    });

    let dependencies = result.dependencies;
    if (dependencies) {
      for (let dep of dependencies) {
        asset.addDependency(dep);
      }
    }

    let connectedFiles = result.connectedFiles;
    if (connectedFiles) {
      for (let file of connectedFiles) {
        asset.addConnectedFile(file);
      }
    }

    return asset;
  }

  async getConfig(
    filePaths: Array<FilePath>,
    options: ?{packageKey?: string, parse?: boolean}
  ): Promise<Config | null> {
    let packageKey = options?.packageKey;
    let parse = options && options.parse;

    if (packageKey != null) {
      let pkg = await this.getPackage();
      if (pkg && pkg[packageKey]) {
        return pkg[packageKey];
      }
    }

    let conf = await loadConfig(
      this.fs,
      this.filePath,
      filePaths,
      parse == null ? null : {parse}
    );
    if (!conf) {
      return null;
    }

    for (let file of conf.files) {
      this.addConnectedFile(file);
    }

    return conf.config;
  }

  async getPackage(): Promise<PackageJSON | null> {
    return this.getConfig(['package.json']);
  }
}
