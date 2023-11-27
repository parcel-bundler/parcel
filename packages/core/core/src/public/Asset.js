// @flow strict-local

import type SourceMap from '@parcel/source-map';
import type {Readable} from 'stream';
import type {FileSystem} from '@parcel/fs';

import type {
  Asset as IAsset,
  AST,
  ASTGenerator,
  Dependency as IDependency,
  DependencyOptions,
  Environment as IEnvironment,
  EnvironmentOptions,
  FileCreateInvalidation,
  FilePath,
  Meta,
  MutableAsset as IMutableAsset,
  Stats,
  MutableAssetSymbols as IMutableAssetSymbols,
  AssetSymbols as IAssetSymbols,
  BundleBehavior,
} from '@parcel/types';
import type {AssetAddr, DependencyAddr} from '@parcel/rust';
import type {ParcelOptions} from '../types';
import type BundleGraph from '../BundleGraph';

import nullthrows from 'nullthrows';
import Environment from './Environment';
import {getPublicDependency} from './Dependency';
import {AssetSymbols, MutableAssetSymbols} from './Symbols';
import UncommittedAsset from '../UncommittedAsset';
import InternalCommittedAsset from '../CommittedAsset';
import {createEnvironment} from '../Environment';
import {fromProjectPath, toProjectPath} from '../projectPath';
import {toInternalSourceLocation} from '../utils';
import {Asset as DbAsset, AssetFlags, readCachedString} from '@parcel/rust';
import {getScopeCache, type Scope} from '../scopeCache';

const inspect = Symbol.for('nodejs.util.inspect.custom');

const _assetToAssetValue: WeakMap<
  IAsset | IMutableAsset | BaseAsset,
  AssetAddr,
> = new WeakMap();

const _mutableAssetToUncommittedAsset: WeakMap<
  IMutableAsset,
  UncommittedAsset,
> = new WeakMap();

export function assetToAssetValue(asset: IAsset | IMutableAsset): AssetAddr {
  return nullthrows(_assetToAssetValue.get(asset));
}

export function mutableAssetToUncommittedAsset(
  mutableAsset: IMutableAsset,
): UncommittedAsset {
  return nullthrows(_mutableAssetToUncommittedAsset.get(mutableAsset));
}

export function assetFromValue(
  value: AssetAddr,
  options: ParcelOptions,
  bundleGraph: BundleGraph,
  scope: Scope,
): CommittedAsset {
  return new CommittedAsset(
    new InternalCommittedAsset(value, options),
    bundleGraph,
    scope,
  );
}

export function uncommittedAssetFromValue(
  value: AssetAddr,
  options: ParcelOptions,
  dependencies: Array<DependencyAddr>,
  scope: Scope,
): Asset {
  return new Asset(
    new UncommittedAsset({
      value: DbAsset.get(options.db, value),
      options,
      dependencies: new Map(dependencies.entries()),
    }),
    scope,
  );
}

class BaseAsset {
  #asset: UncommittedAsset;
  #query: ?URLSearchParams;
  #scope: Scope;

  constructor(asset: UncommittedAsset) {
    this.#asset = asset;
  }

  // $FlowFixMe[unsupported-syntax]
  [inspect](): string {
    return `Asset(${this.filePath})`;
  }

  get id(): string {
    return readCachedString(this.#asset.options.db, this.#asset.value.id);
  }

  get nativeAddress(): number {
    // $FlowFixMe
    return this.#asset.value.addr;
  }

  get type(): string {
    return this.#asset.value.assetType;
  }

  get env(): IEnvironment {
    return new Environment(this.#asset.value.env, this.#asset.options);
  }

  get fs(): FileSystem {
    return this.#asset.options.inputFS;
  }

  get filePath(): FilePath {
    return fromProjectPath(
      this.#asset.options.projectRoot,
      this.#asset.value.filePath,
    );
  }

  get query(): URLSearchParams {
    if (!this.#query) {
      this.#query = new URLSearchParams(this.#asset.value.query ?? '');
    }
    return this.#query;
  }

  get meta(): Meta {
    return new Proxy(this.#asset.meta, {
      get: (target, prop) => {
        let flags = this.#asset.value.flags;
        switch (prop) {
          case 'shouldWrap':
            return Boolean(flags & AssetFlags.SHOULD_WRAP);
          case 'isConstantModule':
            return Boolean(flags & AssetFlags.IS_CONSTANT_MODULE);
          case 'has_node_replacements':
            return Boolean(flags & AssetFlags.HAS_NODE_REPLACEMENTS);
          case 'hasCJSExports':
            return Boolean(flags & AssetFlags.HAS_CJS_EXPORTS);
          case 'staticExports':
            return Boolean(flags & AssetFlags.STATIC_EXPORTS);
          default:
            return target[prop];
        }
      },
      set: (target, prop, value) => {
        let flag;
        switch (prop) {
          case 'shouldWrap':
            flag = AssetFlags.SHOULD_WRAP;
            break;
          case 'isConstantModule':
            flag = AssetFlags.IS_CONSTANT_MODULE;
            break;
          case 'has_node_replacements':
            flag = AssetFlags.HAS_NODE_REPLACEMENTS;
            break;
          case 'hasCJSExports':
            flag = AssetFlags.HAS_CJS_EXPORTS;
            break;
          case 'staticExports':
            flag = AssetFlags.STATIC_EXPORTS;
            break;
          default:
            target[prop] = value;
            return true;
        }

        if (value) {
          this.#asset.value.flags |= flag;
        } else {
          this.#asset.value.flags &= ~flag;
        }
        return true;
      },
    });
  }

  get bundleBehavior(): ?BundleBehavior {
    let bundleBehavior = this.#asset.value.bundleBehavior;
    return bundleBehavior === 'none' ? null : bundleBehavior;
  }

  get isBundleSplittable(): boolean {
    return Boolean(this.#asset.value.flags & AssetFlags.IS_BUNDLE_SPLITTABLE);
  }

  get isSource(): boolean {
    return Boolean(this.#asset.value.flags & AssetFlags.IS_SOURCE);
  }

  get sideEffects(): boolean {
    return Boolean(this.#asset.value.flags & AssetFlags.SIDE_EFFECTS);
  }

  get uniqueKey(): ?string {
    return this.#asset.value.uniqueKey;
  }

  get astGenerator(): ?ASTGenerator {
    return this.#asset.astGenerator;
  }

  get pipeline(): ?string {
    return this.#asset.value.pipeline;
  }

  getDependencies(): $ReadOnlyArray<IDependency> {
    return this.#asset
      .getDependencies()
      .map(dep =>
        getPublicDependency(
          dep,
          this.#asset.options,
          nullthrows(this.#scope, 'Missing scope cache key'),
        ),
      );
  }

  getCode(): Promise<string> {
    return this.#asset.getCode();
  }

  getBuffer(): Promise<Buffer> {
    return this.#asset.getBuffer();
  }

  getStream(): Readable {
    return this.#asset.getStream();
  }

  getMap(): Promise<?SourceMap> {
    return this.#asset.getMap();
  }

  getAST(): Promise<?AST> {
    return this.#asset.getAST();
  }

  getMapBuffer(): Promise<?Buffer> {
    return this.#asset.getMapBuffer();
  }
}

export class Asset extends BaseAsset implements IAsset {
  #asset /*: UncommittedAsset */;
  #env /*: ?Environment */;

  constructor(asset: UncommittedAsset, scope: Scope): Asset {
    let cache = getScopeCache(scope, 'Asset');

    let existing = cache.get(asset.value.addr);
    if (existing != null) {
      return existing;
    }

    super(asset);
    this.#asset = asset;
    cache.set(asset.value.addr, this);
    return this;
  }

  get env(): IEnvironment {
    this.#env ??= new Environment(this.#asset.value.env, this.#asset.options);
    return this.#env;
  }

  get symbols(): IAssetSymbols {
    return new AssetSymbols(this.#asset.options, this.#asset.value.addr);
  }

  get stats(): Stats {
    let stats = this.#asset.value.stats;
    return {
      size: stats.size,
      time: stats.time,
    };
  }
}

export class MutableAsset extends BaseAsset implements IMutableAsset {
  #asset /*: UncommittedAsset */;

  constructor(asset: UncommittedAsset, scope: Scope): MutableAsset {
    let cache = getScopeCache(scope, 'MutableAsset');

    let existing = cache.get(asset.value.addr);
    if (existing != null) {
      return existing;
    }

    super(asset);
    this.#asset = asset;
    cache.set(asset.value.addr, this);
    _mutableAssetToUncommittedAsset.set(this, asset);
    return this;
  }

  setMap(map: ?SourceMap): void {
    this.#asset.setMap(map);
  }

  get type(): string {
    return this.#asset.value.assetType;
  }

  set type(type: string): void {
    if (type !== this.#asset.value.assetType) {
      this.#asset.value.assetType = type;
      this.#asset.updateId();
    }
  }

  get bundleBehavior(): ?BundleBehavior {
    let bundleBehavior = this.#asset.value.bundleBehavior;
    return bundleBehavior === 'none' ? null : bundleBehavior;
  }

  set bundleBehavior(bundleBehavior: ?BundleBehavior): void {
    this.#asset.value.bundleBehavior = bundleBehavior ? bundleBehavior : 'none';
  }

  get isBundleSplittable(): boolean {
    return Boolean(this.#asset.value.flags & AssetFlags.IS_BUNDLE_SPLITTABLE);
  }

  set isBundleSplittable(isBundleSplittable: boolean): void {
    if (isBundleSplittable) {
      this.#asset.value.flags |= AssetFlags.IS_BUNDLE_SPLITTABLE;
    } else {
      this.#asset.value.flags &= ~AssetFlags.IS_BUNDLE_SPLITTABLE;
    }
  }

  get sideEffects(): boolean {
    return Boolean(this.#asset.value.flags & AssetFlags.SIDE_EFFECTS);
  }

  set sideEffects(sideEffects: boolean): void {
    if (sideEffects) {
      this.#asset.value.flags |= AssetFlags.SIDE_EFFECTS;
    } else {
      this.#asset.value.flags &= ~AssetFlags.SIDE_EFFECTS;
    }
  }

  get uniqueKey(): ?string {
    return this.#asset.value.uniqueKey;
  }

  set uniqueKey(uniqueKey: ?string): void {
    if (this.#asset.value.uniqueKey != null) {
      throw new Error(
        "Cannot change an asset's uniqueKey after it has been set.",
      );
    }
    this.#asset.value.uniqueKey = uniqueKey;
  }

  get symbols(): IMutableAssetSymbols {
    return new MutableAssetSymbols(this.#asset.options, this.#asset.value.addr);
  }

  addDependency(dep: DependencyOptions): string {
    return this.#asset.addDependency(dep);
  }

  setNativeDependencies(deps: Array<number>) {
    // $FlowFixMe
    this.#asset.setNativeDependencies(deps);
  }

  invalidateOnFileChange(filePath: FilePath): void {
    this.#asset.invalidateOnFileChange(
      toProjectPath(this.#asset.options.projectRoot, filePath),
    );
  }

  invalidateOnFileCreate(invalidation: FileCreateInvalidation): void {
    this.#asset.invalidateOnFileCreate(invalidation);
  }

  invalidateOnEnvChange(env: string): void {
    this.#asset.invalidateOnEnvChange(env);
  }

  isASTDirty(): boolean {
    return this.#asset.isASTDirty;
  }

  setBuffer(buffer: Buffer): void {
    this.#asset.setBuffer(buffer);
  }

  setCode(code: string): void {
    this.#asset.setCode(code);
  }

  setStream(stream: Readable): void {
    this.#asset.setStream(stream);
  }

  setAST(ast: AST): void {
    return this.#asset.setAST(ast);
  }

  addURLDependency(url: string, opts: $Shape<DependencyOptions>): string {
    return this.addDependency({
      specifier: url,
      specifierType: 'url',
      priority: 'lazy',
      ...opts,
    });
  }

  setEnvironment(env: EnvironmentOptions): void {
    this.#asset.value.env = createEnvironment(this.#asset.options.db, {
      ...env,
      loc: toInternalSourceLocation(this.#asset.options.projectRoot, env.loc),
    });
    this.#asset.updateId();
  }
}

export class CommittedAsset implements IAsset {
  #asset /*: InternalCommittedAsset */;
  #query /*: ?URLSearchParams */;
  #meta /*: ?Meta */;
  #bundleGraph /*: BundleGraph */;
  #scope /*: Scope */;

  constructor(
    asset: InternalCommittedAsset,
    bundleGraph: BundleGraph,
    scope: Scope,
  ): CommittedAsset {
    let cache = getScopeCache(scope, 'CommittedAsset');

    let existing = cache.get(asset.value.addr);
    if (existing != null) {
      return existing;
    }

    this.#scope = scope;
    this.#asset = asset;
    this.#bundleGraph = bundleGraph;
    cache.set(asset.value.addr, this);
    _assetToAssetValue.set(this, asset.value.addr);
    return this;
  }

  get stats(): Stats {
    let stats = this.#asset.value.stats;
    return {
      size: stats.size,
      time: stats.time,
    };
  }

  get id(): string {
    return readCachedString(this.#asset.options.db, this.#asset.value.id);
  }

  get nativeAddress(): number {
    // $FlowFixMe
    return this.#asset.value.addr;
  }

  get type(): string {
    return this.#asset.value.assetType;
  }

  get env(): IEnvironment {
    return new Environment(this.#asset.value.env, this.#asset.options);
  }

  get fs(): FileSystem {
    return this.#asset.options.inputFS;
  }

  get filePath(): FilePath {
    return fromProjectPath(
      this.#asset.options.projectRoot,
      this.#asset.value.filePath,
    );
  }

  get query(): URLSearchParams {
    if (!this.#query) {
      this.#query = new URLSearchParams(this.#asset.value.query ?? '');
    }
    return this.#query;
  }

  get meta(): Meta {
    let flags = this.#asset.value.flags;
    let json = this.#asset.value.meta;
    if (json != null) {
      this.#meta ??= JSON.parse(json);
    }

    return {
      ...this.#meta,
      shouldWrap: Boolean(flags & AssetFlags.SHOULD_WRAP),
      isConstantModule: Boolean(flags & AssetFlags.IS_CONSTANT_MODULE),
      has_node_replacements: Boolean(flags & AssetFlags.HAS_NODE_REPLACEMENTS),
      hasCJSExports: Boolean(flags & AssetFlags.HAS_CJS_EXPORTS),
      staticExports: Boolean(flags & AssetFlags.STATIC_EXPORTS),
    };
  }

  get bundleBehavior(): ?BundleBehavior {
    let bundleBehavior = this.#asset.value.bundleBehavior;
    return bundleBehavior === 'none' ? null : bundleBehavior;
  }

  get isBundleSplittable(): boolean {
    return Boolean(this.#asset.value.flags & AssetFlags.IS_BUNDLE_SPLITTABLE);
  }

  get isSource(): boolean {
    return Boolean(this.#asset.value.flags & AssetFlags.IS_SOURCE);
  }

  get sideEffects(): boolean {
    return Boolean(this.#asset.value.flags & AssetFlags.SIDE_EFFECTS);
  }

  get symbols(): IAssetSymbols {
    return new AssetSymbols(this.#asset.options, this.#asset.value.addr);
  }

  get uniqueKey(): ?string {
    return this.#asset.value.uniqueKey;
  }

  get astGenerator(): ?ASTGenerator {
    let ast = this.#asset.value.ast;
    if (ast) {
      return {
        type: ast.generator,
        version: ast.version,
      };
    }
    return null;
  }

  get pipeline(): ?string {
    return this.#asset.value.pipeline;
  }

  getDependencies(): $ReadOnlyArray<IDependency> {
    return this.#bundleGraph
      .getDependencies(this.#asset.value.addr)
      .map(dep => getPublicDependency(dep, this.#asset.options, this.#scope));
  }

  getCode(): Promise<string> {
    return this.#asset.getCode();
  }

  getBuffer(): Promise<Buffer> {
    return this.#asset.getBuffer();
  }

  getStream(): Readable {
    return this.#asset.getStream();
  }

  getMap(): Promise<?SourceMap> {
    return this.#asset.getMap(this.#scope);
  }

  getAST(): Promise<?AST> {
    return this.#asset.getAST();
  }

  getMapBuffer(): Promise<?Buffer> {
    return this.#asset.getMapBuffer(this.#scope);
  }
}
