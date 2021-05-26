// @flow strict-local

import type {
  AST,
  Blob,
  ConfigResult,
  DependencyOptions,
  FilePath,
  FileCreateInvalidation,
  GenerateOutput,
  PackageJSON,
  PackageName,
  TransformerResult,
} from '@parcel/types';
import type {
  Asset,
  RequestInvalidation,
  Dependency,
  ParcelOptions,
} from './types';

import v8 from 'v8';
import invariant from 'assert';
import {Readable} from 'stream';
import SourceMap from '@parcel/source-map';
import {
  bufferStream,
  md5FromString,
  blobToStream,
  streamFromPromise,
  TapStream,
  loadSourceMap,
  SOURCEMAP_RE,
} from '@parcel/utils';
import {createDependency, mergeDependencies} from './Dependency';
import {mergeEnvironments} from './Environment';
import {PARCEL_VERSION} from './constants';
import {
  createAsset,
  createAssetIdFromOptions,
  getConfig,
  getInvalidationId,
  getInvalidationHash,
} from './assetUtils';

type UncommittedAssetOptions = {|
  value: Asset,
  options: ParcelOptions,
  content?: ?Blob,
  mapBuffer?: ?Buffer,
  ast?: ?AST,
  isASTDirty?: ?boolean,
  idBase?: ?string,
  invalidations?: Map<string, RequestInvalidation>,
  fileCreateInvalidations?: Array<FileCreateInvalidation>,
|};

export default class UncommittedAsset {
  value: Asset;
  options: ParcelOptions;
  content: ?(Blob | Promise<Buffer>);
  mapBuffer: ?Buffer;
  sourceContent: ?string;
  map: ?SourceMap;
  ast: ?AST;
  isASTDirty: boolean;
  idBase: ?string;
  invalidations: Map<string, RequestInvalidation>;
  fileCreateInvalidations: Array<FileCreateInvalidation>;
  generate: ?() => Promise<GenerateOutput>;

  constructor({
    value,
    options,
    content,
    mapBuffer,
    ast,
    isASTDirty,
    idBase,
    invalidations,
    fileCreateInvalidations,
  }: UncommittedAssetOptions) {
    this.value = value;
    this.options = options;
    this.content = content;
    this.mapBuffer = mapBuffer;
    this.ast = ast;
    this.isASTDirty = isASTDirty || false;
    this.idBase = idBase;
    this.invalidations = invalidations || new Map();
    this.fileCreateInvalidations = fileCreateInvalidations || [];
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
        this.commitContent(contentKey).then(s => (size = s)),
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
      [
        this.value.hash,
        pipelineKey,
        await getInvalidationHash(this.getInvalidations(), this.options),
      ].join(':'),
    );

    if (this.content != null) {
      this.value.stats.size = size;
    }

    this.value.committed = true;
  }

  async commitContent(contentKey: string): Promise<number> {
    let content = await this.content;
    if (content == null) {
      return 0;
    }

    let size = 0;
    if (content instanceof Readable) {
      await this.options.cache.setStream(
        contentKey,
        content.pipe(
          new TapStream(buf => {
            size += buf.length;
          }),
        ),
      );

      return size;
    }

    if (typeof content === 'string') {
      size = Buffer.byteLength(content);
    } else {
      size = content.length;
    }

    await this.options.cache.setBlob(contentKey, content);
    return size;
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

    invariant(false, 'Internal error: missing content');
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

  async loadExistingSourcemap(): Promise<?SourceMap> {
    if (this.map) {
      return this.map;
    }

    let code = await this.getCode();
    let map = await loadSourceMap(this.value.filePath, code, {
      fs: this.options.inputFS,
      projectRoot: this.options.projectRoot,
    });

    if (map) {
      this.map = map;
      this.mapBuffer = map.toBuffer();
      this.setCode(code.replace(SOURCEMAP_RE, ''));
    }

    return this.map;
  }

  getMapBuffer(): Promise<?Buffer> {
    return Promise.resolve(this.mapBuffer);
  }

  async getMap(): Promise<?SourceMap> {
    if (this.map == null) {
      let mapBuffer = this.mapBuffer ?? (await this.getMapBuffer());
      if (mapBuffer) {
        // Get sourcemap from flatbuffer
        let map = new SourceMap(this.options.projectRoot);
        map.addBuffer(mapBuffer);
        this.map = map;
      }
    }

    return this.map;
  }

  setMap(map: ?SourceMap): void {
    // If we have sourceContent available, it means this asset is source code without
    // a previous source map. Ensure that the map set by the transformer has the original
    // source content available.
    if (map && this.sourceContent != null) {
      map.setSourceContent(this.value.filePath, this.sourceContent);
    }

    this.map = map;
    this.mapBuffer = this.map?.toBuffer();
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

  addDependency(opts: DependencyOptions): string {
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

  addIncludedFile(filePath: FilePath) {
    let invalidation: RequestInvalidation = {
      type: 'file',
      filePath,
    };

    this.invalidations.set(getInvalidationId(invalidation), invalidation);
  }

  invalidateOnFileCreate(invalidation: FileCreateInvalidation) {
    this.fileCreateInvalidations.push(invalidation);
  }

  invalidateOnEnvChange(key: string) {
    let invalidation: RequestInvalidation = {
      type: 'env',
      key,
    };

    this.invalidations.set(getInvalidationId(invalidation), invalidation);
  }

  getInvalidations(): Array<RequestInvalidation> {
    return [...this.invalidations.values()];
  }

  getDependencies(): Array<Dependency> {
    return Array.from(this.value.dependencies.values());
  }

  createChildAsset(
    result: TransformerResult,
    plugin: PackageName,
    configPath: FilePath,
    configKeyPath?: string,
  ): UncommittedAsset {
    let content = result.content ?? null;

    let asset = new UncommittedAsset({
      value: createAsset({
        idBase: this.idBase,
        hash: this.value.hash,
        filePath: this.value.filePath,
        type: result.type,
        query: result.query,
        isIsolated: result.isIsolated ?? this.value.isIsolated,
        isInline: result.isInline ?? this.value.isInline,
        isSplittable: result.isSplittable ?? this.value.isSplittable,
        isSource: result.isSource ?? this.value.isSource,
        env: mergeEnvironments(this.value.env, result.env),
        dependencies:
          this.value.type === result.type
            ? new Map(this.value.dependencies)
            : new Map(),
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
        // $FlowFixMe
        symbols: result.symbols,
        sideEffects: result.sideEffects ?? this.value.sideEffects,
        uniqueKey: result.uniqueKey,
        astGenerator: result.ast
          ? {type: result.ast.type, version: result.ast.version}
          : null,
        plugin,
        configPath,
        configKeyPath,
      }),
      options: this.options,
      content,
      ast: result.ast,
      isASTDirty: result.ast === this.ast ? this.isASTDirty : true,
      mapBuffer: result.map ? result.map.toBuffer() : null,
      idBase: this.idBase,
      invalidations: this.invalidations,
      fileCreateInvalidations: this.fileCreateInvalidations,
    });

    let dependencies = result.dependencies;
    if (dependencies) {
      for (let dep of dependencies) {
        asset.addDependency(dep);
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
      this.addIncludedFile(file.filePath);
    }

    return conf.config;
  }

  getPackage(): Promise<PackageJSON | null> {
    return this.getConfig(['package.json']);
  }

  updateId() {
    // $FlowFixMe - this is fine
    this.value.id = createAssetIdFromOptions(this.value);
  }
}
