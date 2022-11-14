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
import type {
  Asset as AssetValue,
  CommittedAsset as CommittedAssetRef,
  ParcelOptions,
} from '../types';

import nullthrows from 'nullthrows';
import Environment from './Environment';
import Dependency from './Dependency';
import {AssetSymbols, MutableAssetSymbols} from './Symbols';
import UncommittedAsset from '../UncommittedAsset';
import InternalCommittedAsset from '../CommittedAsset';
import {createEnvironment} from '../Environment';
import {fromProjectPath, toProjectPath} from '../projectPath';
import {
  BundleBehavior as BundleBehaviorMap,
  BundleBehaviorNames,
} from '../types';
import {toInternalSourceLocation} from '../utils';
import db from '@parcel/db';

const inspect = Symbol.for('nodejs.util.inspect.custom');

const uncommittedAssetValueToAsset: WeakMap<AssetValue, Asset> = new WeakMap();
const committedAssetValueToAsset: Map<CommittedAssetRef, ComittedAsset> =
  new Map();
const assetValueToMutableAsset: WeakMap<AssetValue, MutableAsset> =
  new WeakMap();

const _assetToAssetValue: WeakMap<
  IAsset | IMutableAsset | BaseAsset,
  CommittedAssetRef,
> = new WeakMap();

const _mutableAssetToUncommittedAsset: WeakMap<
  IMutableAsset,
  UncommittedAsset,
> = new WeakMap();

export function assetToAssetValue(
  asset: IAsset | IMutableAsset,
): CommittedAssetRef {
  return nullthrows(_assetToAssetValue.get(asset));
}

export function mutableAssetToUncommittedAsset(
  mutableAsset: IMutableAsset,
): UncommittedAsset {
  return nullthrows(_mutableAssetToUncommittedAsset.get(mutableAsset));
}

export function assetFromValue(
  value: CommittedAssetRef,
  options: ParcelOptions,
): ComittedAsset {
  // return new Asset(
  //   value.committed
  //     ? new InternalCommittedAsset(value, options)
  //     : new UncommittedAsset({
  //         value,
  //         options,
  //       }),
  // );
  return new ComittedAsset(new InternalCommittedAsset(value, options));
}

class BaseAsset {
  #asset: UncommittedAsset;
  #query /*: ?URLSearchParams */;

  constructor(asset: UncommittedAsset) {
    this.#asset = asset;
    // _assetToAssetValue.set(this, asset.value);
  }

  // $FlowFixMe[unsupported-syntax]
  [inspect](): string {
    return `Asset(${this.filePath})`;
  }

  get id(): string {
    return this.#asset.value.id;
  }

  get type(): string {
    return this.#asset.value.type;
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
    return this.#asset.value.meta;
  }

  get bundleBehavior(): ?BundleBehavior {
    let bundleBehavior = this.#asset.value.bundleBehavior;
    return bundleBehavior == null ? null : BundleBehaviorNames[bundleBehavior];
  }

  get isBundleSplittable(): boolean {
    return this.#asset.value.isBundleSplittable;
  }

  get isSource(): boolean {
    return this.#asset.value.isSource;
  }

  get sideEffects(): boolean {
    return this.#asset.value.sideEffects;
  }

  get symbols(): IAssetSymbols {
    return new AssetSymbols(this.#asset.options, this.#asset.value);
  }

  get uniqueKey(): ?string {
    return this.#asset.value.uniqueKey;
  }

  get astGenerator(): ?ASTGenerator {
    return this.#asset.value.astGenerator;
  }

  get pipeline(): ?string {
    return this.#asset.value.pipeline;
  }

  getDependencies(): $ReadOnlyArray<IDependency> {
    return this.#asset
      .getDependencies()
      .map(dep => new Dependency(dep, this.#asset.options));
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

  constructor(asset: UncommittedAsset): Asset {
    let existing = uncommittedAssetValueToAsset.get(asset.value);
    if (existing != null) {
      return existing;
    }

    super(asset);
    this.#asset = asset;
    uncommittedAssetValueToAsset.set(asset.value, this);
    return this;
  }

  get stats(): Stats {
    return this.#asset.value.stats;
  }
}

export class MutableAsset extends BaseAsset implements IMutableAsset {
  #asset /*: UncommittedAsset */;

  constructor(asset: UncommittedAsset): MutableAsset {
    let existing = assetValueToMutableAsset.get(asset.value);
    if (existing != null) {
      return existing;
    }

    super(asset);
    this.#asset = asset;
    assetValueToMutableAsset.set(asset.value, this);
    _mutableAssetToUncommittedAsset.set(this, asset);
    return this;
  }

  setMap(map: ?SourceMap): void {
    this.#asset.setMap(map);
  }

  get type(): string {
    return this.#asset.value.type;
  }

  set type(type: string): void {
    if (type !== this.#asset.value.type) {
      this.#asset.value.type = type;
      this.#asset.updateId();
    }
  }

  get bundleBehavior(): ?BundleBehavior {
    let bundleBehavior = this.#asset.value.bundleBehavior;
    return bundleBehavior == null ? null : BundleBehaviorNames[bundleBehavior];
  }

  set bundleBehavior(bundleBehavior: ?BundleBehavior): void {
    this.#asset.value.bundleBehavior = bundleBehavior
      ? BundleBehaviorMap[bundleBehavior]
      : null;
  }

  get isBundleSplittable(): boolean {
    return this.#asset.value.isBundleSplittable;
  }

  set isBundleSplittable(isBundleSplittable: boolean): void {
    this.#asset.value.isBundleSplittable = isBundleSplittable;
  }

  get sideEffects(): boolean {
    return this.#asset.value.sideEffects;
  }

  set sideEffects(sideEffects: boolean): void {
    this.#asset.value.sideEffects = sideEffects;
  }

  get symbols(): IMutableAssetSymbols {
    return new MutableAssetSymbols(this.#asset.options, this.#asset.value);
  }

  addDependency(dep: DependencyOptions): string {
    return this.#asset.addDependency(dep);
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
    this.#asset.value.env = createEnvironment({
      ...env,
      loc: toInternalSourceLocation(this.#asset.options.projectRoot, env.loc),
    });
    this.#asset.updateId();
  }
}

export class ComittedAsset implements IAsset {
  #asset /*: InternalCommittedAsset */;
  #query /*: ?URLSearchParams */;

  constructor(asset: InternalCommittedAsset): ComittedAsset {
    let existing = committedAssetValueToAsset.get(asset.value);
    if (existing != null) {
      return existing;
    }

    this.#asset = asset;
    committedAssetValueToAsset.set(asset.value, this);
    _assetToAssetValue.set(this, asset.value);
    return this;
  }

  get stats(): Stats {
    return {
      time: 0,
      size: 0,
    };
  }

  get id(): string {
    return 'asset:' + this.#asset.value;
  }

  get type(): string {
    // return this.#asset.value.type;
    return 'js'; // TODO
  }

  get env(): IEnvironment {
    return new Environment(db.assetEnv(this.#asset.value), this.#asset.options);
  }

  get fs(): FileSystem {
    return this.#asset.options.inputFS;
  }

  get filePath(): FilePath {
    return fromProjectPath(
      this.#asset.options.projectRoot,
      db.assetFileId(this.#asset.value),
    );
  }

  get query(): URLSearchParams {
    if (!this.#query) {
      this.#query = new URLSearchParams(this.#asset.value.query ?? '');
    }
    return this.#query;
  }

  get meta(): Meta {
    return this.#asset.value.meta ?? {};
  }

  get bundleBehavior(): ?BundleBehavior {
    let bundleBehavior = db.assetBundleBehavior(this.#asset.value);
    return bundleBehavior == 0 ? null : BundleBehaviorNames[bundleBehavior];
  }

  get isBundleSplittable(): boolean {
    return db.assetIsBundleSplittable(this.#asset.value);
  }

  get isSource(): boolean {
    return db.assetIsSource(this.#asset.value);
  }

  get sideEffects(): boolean {
    return db.assetSideEffects(this.#asset.value);
  }

  get symbols(): IAssetSymbols {
    return new AssetSymbols(this.#asset.options, this.#asset.value);
  }

  get uniqueKey(): ?string {
    return this.#asset.value.uniqueKey;
  }

  get astGenerator(): ?ASTGenerator {
    return this.#asset.value.astGenerator;
  }

  get pipeline(): ?string {
    return this.#asset.value.pipeline;
  }

  getDependencies(): $ReadOnlyArray<IDependency> {
    return this.#asset
      .getDependencies()
      .map(dep => new Dependency(dep, this.#asset.options));
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
