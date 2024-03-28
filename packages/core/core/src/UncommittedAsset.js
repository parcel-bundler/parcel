/* eslint-disable */
// @flow strict-local

import type {
  AST,
  ASTGenerator,
  Blob,
  DependencyOptions,
  FileCreateInvalidation,
  GenerateOutput,
  PackageName,
  TransformerResult,
  Meta,
} from '@parcel/types';
import type {
  RequestInvalidation,
  ParcelOptions,
  Invalidations,
  InternalFileCreateInvalidation,
} from './types';
import type {DependencyAddr} from '@parcel/rust';
import type {DependencyOpts} from './Dependency';

import invariant from 'assert';
import {Readable} from 'stream';
import SourceMap from '@parcel/source-map';
import {
  blobToStream,
  bufferStream,
  streamFromPromise,
  TapStream,
  loadSourceMap,
  SOURCEMAP_RE,
} from '@parcel/utils';
import {hashString, hashBuffer, Hash} from '@parcel/rust';
import {serializeRaw} from './serializer';
import {createDependency, dependencyId, mergeDependencies} from './Dependency';
import {mergeEnvironments} from './Environment';
import {PARCEL_VERSION} from './constants';
import {createAsset, createAssetIdFromOptions} from './assetUtils';
import {invalidateOnFileCreateToInternal, createInvalidations} from './utils';
import {type ProjectPath, fromProjectPath} from './projectPath';
import {
  Asset as DbAsset,
  AssetFlags,
  AssetAst,
  Dependency as DbDependency,
} from '@parcel/rust';
import nullthrows from 'nullthrows';

type UncommittedAssetOptions = {|
  value: DbAsset,
  plugin?: PackageName,
  configPath?: ProjectPath,
  configKeyPath?: string,
  options: ParcelOptions,
  content?: ?Blob,
  mapBuffer?: ?Buffer,
  ast?: ?AST,
  isASTDirty?: ?boolean,
  idBase?: ?string,
  invalidations?: Invalidations,
  dependencies?: Map<number, DependencyAddr>,
|};

export default class UncommittedAsset {
  value: DbAsset;
  options: ParcelOptions;
  content: ?(Blob | Promise<Buffer>);
  mapBuffer: ?Buffer;
  sourceContent: ?string;
  map: ?SourceMap;
  ast: ?AST;
  isASTDirty: boolean;
  idBase: ?string;
  invalidations: Invalidations;
  generate: ?() => Promise<GenerateOutput>;

  dependencies: Map<number, DependencyAddr>;
  meta: Meta;
  astGenerator: ?ASTGenerator;
  plugin: ?PackageName;
  configPath: ?ProjectPath;
  configKeyPath: ?string;

  constructor({
    value,
    options,
    content,
    mapBuffer,
    ast,
    isASTDirty,
    idBase,
    invalidations,
    plugin,
    configPath,
    configKeyPath,
    dependencies,
  }: UncommittedAssetOptions) {
    this.value = value;
    this.options = options;
    this.content = content;
    this.mapBuffer = mapBuffer;
    this.ast = ast;
    this.isASTDirty = isASTDirty || false;
    this.idBase = idBase;
    this.invalidations = invalidations || createInvalidations();
    this.plugin = plugin;
    this.configPath = configPath;
    this.configKeyPath = configKeyPath;
    this.meta = {};
    this.dependencies = dependencies || new Map();
  }

  /*
   * Prepares the asset for being serialized to the cache by committing its
   * content and map of the asset to the cache.
   */
  async commit(): Promise<void> {
    // If there is a dirty AST, clear out any old content and map as these
    // must be regenerated later and shouldn't be committed.
    if (this.ast != null && this.isASTDirty) {
      this.content = null;
      this.mapBuffer = null;
    }

    let size = 0;
    let outputHash = '';
    let contentKey = this.content == null ? null : this.getCacheKey('content');
    let mapKey = this.mapBuffer == null ? null : this.getCacheKey('map');
    let astKey = this.ast == null ? null : this.getCacheKey('ast');

    // Since we can only read from the stream once, compute the content length
    // and hash while it's being written to the cache.
    await Promise.all([
      contentKey != null &&
        this.commitContent(contentKey).then(
          s => ((size = s.size), (outputHash = s.hash)),
        ),
      this.mapBuffer != null &&
        mapKey != null &&
        this.options.cache.setBlob(mapKey, this.mapBuffer),
      astKey != null &&
        this.options.cache.setBlob(astKey, serializeRaw(this.ast)),
    ]);
    this.value.contentKey = nullthrows(contentKey);
    this.value.mapKey = mapKey;

    if (astKey != null) {
      let ast = new AssetAst(this.options.db);
      ast.key = astKey;
      ast.plugin = nullthrows(this.plugin);
      ast.configPath = nullthrows(this.configPath);
      ast.configKeyPath = this.configKeyPath;
      ast.generator = nullthrows(this.astGenerator).type;
      ast.version = nullthrows(this.astGenerator).version;
      this.value.ast = ast;
      ast.dealloc();
    }

    this.value.meta = JSON.stringify(this.meta);
    this.value.outputHash = outputHash;

    if (this.content != null) {
      this.value.stats.size = size;
    }

    if (this.content instanceof Readable) {
      this.value.flags |= AssetFlags.LARGE_BLOB;
    }

    // Asset address may have changed since deps were originally created.
    for (let id of this.dependencies.values()) {
      let dep = DbDependency.get(this.options.db, id);
      dep.sourceAssetId = this.value.addr;
    }
  }

  async commitContent(
    contentKey: string,
  ): Promise<{|size: number, hash: string|}> {
    let content = await this.content;
    if (content == null) {
      return {size: 0, hash: ''};
    }

    let size = 0;
    if (content instanceof Readable) {
      let hash = new Hash();
      await this.options.cache.setStream(
        contentKey,
        content.pipe(
          new TapStream(buf => {
            hash.writeBuffer(buf);
            size += buf.length;
          }),
        ),
      );

      return {size, hash: hash.finish()};
    }

    let hash;
    if (typeof content === 'string') {
      hash = hashString(content);
      size = Buffer.byteLength(content);
    } else {
      hash = hashBuffer(content);
      size = content.length;
    }

    await this.options.cache.setBlob(contentKey, content);
    return {size, hash};
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
    } else if (content instanceof Buffer) {
      return content;
    } else if (typeof content === 'string') {
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
    let map = await loadSourceMap(
      fromProjectPath(this.options.projectRoot, this.value.filePath),
      code,
      {
        fs: this.options.inputFS,
        projectRoot: this.options.projectRoot,
      },
    );

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
        this.map = new SourceMap(this.options.projectRoot, mapBuffer);
      }
    }

    return this.map;
  }

  setMap(map: ?SourceMap): void {
    // If we have sourceContent available, it means this asset is source code without
    // a previous source map. Ensure that the map set by the transformer has the original
    // source content available.
    if (map != null && this.sourceContent != null) {
      map.setSourceContent(
        fromProjectPath(this.options.projectRoot, this.value.filePath),
        // $FlowFixMe
        this.sourceContent,
      );
      this.sourceContent = null;
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
    this.astGenerator = {
      type: ast.type,
      version: ast.version,
    };
  }

  clearAST() {
    this.ast = null;
    this.isASTDirty = false;
    this.astGenerator = null;
  }

  getCacheKey(key: string): string {
    return hashString(PARCEL_VERSION + key + this.value.id);
  }

  addDependency(opts: DependencyOptions): string {
    // eslint-disable-next-line no-unused-vars
    let {env, symbols, ...rest} = opts;
    let options: DependencyOpts = {
      ...rest,
      // $FlowFixMe "convert" the $ReadOnlyMaps to the interal mutable one
      symbols,
      env: mergeEnvironments(
        this.options.db,
        this.options.projectRoot,
        this.value.env,
        env,
      ),
      sourceAssetId: this.value.addr,
      sourcePath: fromProjectPath(
        this.options.projectRoot,
        this.value.filePath,
      ),
    };

    let dep;
    let hash = dependencyId(this.options.db, options);
    let id = this.options.db.getStringId(hash);
    let existing = this.dependencies.get(id);
    if (existing != null) {
      mergeDependencies(
        this.options.db,
        this.options.projectRoot,
        existing,
        options,
      );
      dep = existing;
    } else {
      options.id = id;
      dep = createDependency(
        this.options.db,
        this.options.projectRoot,
        options,
      );
      this.dependencies.set(id, dep);
    }
    return hash;
  }

  setNativeDependencies(deps: Array<DependencyAddr>) {
    for (let d of deps) {
      this.dependencies.set(DbDependency.get(this.options.db, d).id, d);
    }
  }

  invalidateOnFileChange(filePath: ProjectPath) {
    this.invalidations.invalidateOnFileChange.add(filePath);
  }

  invalidateOnFileCreate(invalidation: FileCreateInvalidation) {
    this.invalidations.invalidateOnFileCreate.push(
      invalidateOnFileCreateToInternal(this.options.projectRoot, invalidation),
    );
  }

  invalidateOnEnvChange(key: string) {
    this.invalidations.invalidateOnEnvChange.add(key);
  }

  invalidateOnBuild() {
    this.invalidations.invalidateOnBuild = true;
  }

  invalidateOnStartup() {
    this.invalidations.invalidateOnStartup = true;
  }

  getDependencies(): Array<DependencyAddr> {
    return Array.from(this.dependencies.values());
  }

  createChildAsset(
    result: TransformerResult,
    plugin: PackageName,
    configPath: ProjectPath,
    configKeyPath?: string,
  ): UncommittedAsset {
    let content = result.content ?? null;

    let asset = new UncommittedAsset({
      value: createAsset(this.options.db, this.options.projectRoot, {
        idBase: this.idBase,
        filePath: this.value.filePath,
        type: result.type,
        bundleBehavior: result.bundleBehavior ?? this.value.bundleBehavior,
        isBundleSplittable:
          result.isBundleSplittable ??
          Boolean(this.value.flags & AssetFlags.IS_BUNDLE_SPLITTABLE),
        isSource: Boolean(this.value.flags & AssetFlags.IS_SOURCE),
        env: mergeEnvironments(
          this.options.db,
          this.options.projectRoot,
          this.value.env,
          result.env,
        ),
        pipeline:
          result.pipeline ??
          (this.value.assetType === result.type ? this.value.pipeline : null),
        stats: {
          time: 0,
          size: this.value.stats.size,
        },
        // $FlowFixMe
        symbols: result.symbols,
        sideEffects:
          result.sideEffects ??
          Boolean(this.value.flags & AssetFlags.SIDE_EFFECTS),
        uniqueKey: result.uniqueKey,
      }),
      options: this.options,
      content,
      ast: result.ast,
      isASTDirty: result.ast === this.ast ? this.isASTDirty : true,
      mapBuffer: result.map ? result.map.toBuffer() : null,
      idBase: this.idBase,
      invalidations: this.invalidations,
    });

    asset.astGenerator = result.ast
      ? {type: result.ast.type, version: result.ast.version}
      : null;
    asset.plugin = plugin;
    asset.configPath = configPath;
    asset.configKeyPath = configKeyPath;
    asset.meta = {
      ...this.meta,
      ...result.meta,
    };

    if (this.value.assetType === result.type) {
      asset.dependencies = new Map(this.dependencies);
    }

    let dependencies = result.dependencies;
    if (dependencies) {
      for (let dep of dependencies) {
        asset.addDependency(dep);
      }
    }

    return asset;
  }

  updateId() {
    this.value.id = this.options.db.getStringId(
      createAssetIdFromOptions({
        uniqueKey: this.value.uniqueKey,
        idBase: this.idBase,
        filePath: this.value.filePath,
        type: this.value.assetType,
        env: this.value.env,
        pipeline: this.value.pipeline,
        query: this.value.query,
      }),
    );
  }
}
