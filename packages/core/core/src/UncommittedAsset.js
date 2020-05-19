// @flow strict-local

import type {
  AST,
  Blob,
  ConfigResult,
  DependencyOptions,
  File,
  FilePath,
  PackageJSON,
  PackageName,
  TransformerResult,
} from '@parcel/types';
import type {Asset, Dependency, ParcelOptions} from './types';

import v8 from 'v8';
import {Readable} from 'stream';
import SourceMap from '@parcel/source-map';
import {
  bufferStream,
  md5FromString,
  blobToStream,
  streamFromPromise,
  TapStream,
} from '@parcel/utils';
import {createDependency, mergeDependencies} from './Dependency';
import {mergeEnvironments} from './Environment';
import {PARCEL_VERSION} from './constants';
import {createAsset, getConfig} from './assetUtils';

type UncommittedAssetOptions = {|
  value: Asset,
  options: ParcelOptions,
  content?: ?Blob,
  mapBuffer?: ?Buffer,
  ast?: ?AST,
  isASTDirty?: ?boolean,
  idBase?: ?string,
|};

export default class UncommittedAsset {
  value: Asset;
  options: ParcelOptions;
  content: ?(Blob | Promise<Buffer>);
  mapBuffer: ?Buffer;
  map: ?SourceMap;
  ast: ?AST;
  isASTDirty: boolean;
  idBase: ?string;

  constructor({
    value,
    options,
    content,
    mapBuffer,
    ast,
    isASTDirty,
    idBase,
  }: UncommittedAssetOptions) {
    this.value = value;
    this.options = options;
    this.content = content;
    this.mapBuffer = mapBuffer;
    this.ast = ast;
    this.isASTDirty = isASTDirty || false;
    this.idBase = idBase;
  }

  /*
   * Prepares the asset for being serialized to the cache by commiting its
   * content and map of the asset to the cache.
   */
  async commit(pipelineKey: string): Promise<void> {
    // If there is a dirty AST, clear out any old content and map as these
    // must be regenerated later and shouldn't be committed.
    if (this.ast != null && this.isASTDirty) {
      this.content = null;
      this.mapBuffer = null;
    }

    let size = 0;
    let contentKey =
      this.content == null ? null : this.getCacheKey('content' + pipelineKey);
    let mapKey =
      this.mapBuffer == null ? null : this.getCacheKey('map' + pipelineKey);
    let astKey =
      this.ast == null ? null : this.getCacheKey('ast' + pipelineKey);

    // Since we can only read from the stream once, compute the content length
    // and hash while it's being written to the cache.
    await Promise.all([
      contentKey != null &&
        this.options.cache.setStream(
          contentKey,
          this.getStream().pipe(
            new TapStream(buf => {
              size += buf.length;
            }),
          ),
        ),
      this.mapBuffer != null &&
        mapKey != null &&
        this.options.cache.setBlob(mapKey, this.mapBuffer),
      astKey != null &&
        this.options.cache.setBlob(
          astKey,
          // $FlowFixMe
          v8.serialize(this.ast),
        ),
    ]);
    this.value.contentKey = contentKey;
    this.value.mapKey = mapKey;
    this.value.astKey = astKey;
    this.value.outputHash = md5FromString(
      [this.value.hash, pipelineKey].join(':'),
    );

    if (this.content != null) {
      this.value.stats.size = size;
    }

    this.value.committed = true;
  }

  async getCode(): Promise<string> {
    if (this.ast != null && this.isASTDirty) {
      throw new Error(
        'Cannot call getCode() on an asset with a dirty AST. For transformers, implement canReuseAST() and check asset.isASTDirty.',
      );
    }

    let content = await this.content;
    if (typeof content === 'string' || content instanceof Buffer) {
      return content.toString();
    } else if (content != null) {
      this.content = bufferStream(content);
      return (await this.content).toString();
    }

    return '';
  }

  async getBuffer(): Promise<Buffer> {
    let content = await this.content;
    if (content == null) {
      return Buffer.alloc(0);
    } else if (typeof content === 'string' || content instanceof Buffer) {
      return Buffer.from(content);
    }

    this.content = bufferStream(content);
    return this.content;
  }

  getStream(): Readable {
    if (this.content instanceof Readable) {
      // Remove content if it's a stream, as it should not be reused.
      let content = this.content;
      this.content = null;
      return content;
    }

    if (this.content instanceof Promise) {
      return streamFromPromise(this.content);
    }

    return blobToStream(this.content ?? Buffer.alloc(0));
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

  getMapBuffer(): Promise<?Buffer> {
    return Promise.resolve(this.mapBuffer);
  }

  async getMap(): Promise<?SourceMap> {
    if (this.map == null) {
      let mapBuffer = this.mapBuffer ?? (await this.getMapBuffer());
      if (mapBuffer) {
        // Get sourcemap from flatbuffer
        let map = new SourceMap();
        map.addBufferMappings(mapBuffer);
        this.map = map;
      }
    }

    return this.map;
  }

  setMap(map: ?SourceMap): void {
    this.mapBuffer = map?.toBuffer();
  }

  getAST(): Promise<?AST> {
    return Promise.resolve(this.ast);
  }

  setAST(ast: AST): void {
    this.ast = ast;
    this.isASTDirty = true;
    this.value.astGenerator = {
      type: ast.type,
      version: ast.version,
    };
  }

  clearAST() {
    this.ast = null;
    this.isASTDirty = false;
    this.value.astGenerator = null;
  }

  getCacheKey(key: string): string {
    return md5FromString(
      PARCEL_VERSION + key + this.value.id + (this.value.hash || ''),
    );
  }

  addDependency(opts: DependencyOptions) {
    // eslint-disable-next-line no-unused-vars
    let {env, target, symbols, ...rest} = opts;
    let dep = createDependency({
      ...rest,
      // $FlowFixMe "convert" the $ReadOnlyMaps to the interal mutable one
      symbols,
      env: mergeEnvironments(this.value.env, env),
      sourceAssetId: this.value.id,
      sourcePath: this.value.filePath,
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
    plugin: PackageName,
    configPath: FilePath,
  ): UncommittedAsset {
    let content = result.content ?? null;

    let asset = new UncommittedAsset({
      value: createAsset({
        idBase: this.idBase,
        hash: this.value.hash,
        filePath: this.value.filePath,
        type: result.type,
        isIsolated: result.isIsolated ?? this.value.isIsolated,
        isInline: result.isInline ?? this.value.isInline,
        isSplittable: result.isSplittable ?? this.value.isSplittable,
        isSource: result.isSource ?? this.value.isSource,
        env: mergeEnvironments(this.value.env, result.env),
        dependencies:
          this.value.type === result.type
            ? new Map(this.value.dependencies)
            : new Map(),
        includedFiles: new Map(this.value.includedFiles),
        meta: {
          ...this.value.meta,
          ...result.meta,
        },
        pipeline:
          result.pipeline ??
          (this.value.type === result.type ? this.value.pipeline : null),
        stats: {
          time: 0,
          size: this.value.stats.size,
        },
        symbols: !result.symbols
          ? // TODO clone?
            this.value.symbols
          : new Map([...(this.value.symbols || []), ...(result.symbols || [])]),
        sideEffects: result.sideEffects ?? this.value.sideEffects,
        uniqueKey: result.uniqueKey,
        astGenerator: result.ast
          ? {type: result.ast.type, version: result.ast.version}
          : null,
        plugin,
        configPath,
      }),
      options: this.options,
      content,
      ast: result.ast,
      isASTDirty: result.ast === this.ast ? this.isASTDirty : true,
      mapBuffer: result.map ? result.map.toBuffer() : null,
      idBase: this.idBase,
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
      parse?: boolean,
    |},
  ): Promise<ConfigResult | null> {
    let conf = await getConfig(this, filePaths, options);
    if (conf == null) {
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
