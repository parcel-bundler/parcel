// @flow strict-local
// flowlint unsafe-getters-setters:off

import type SourceMap from '@parcel/source-map';
import type {Readable} from 'stream';
import type {FileSystem} from '@parcel/fs';

import type {
  Asset as IAsset,
  AST,
  ASTGenerator,
  ConfigResult,
  Dependency as IDependency,
  DependencyOptions,
  Environment as IEnvironment,
  EnvironmentOpts,
  File,
  FilePath,
  Meta,
  MutableAsset as IMutableAsset,
  PackageJSON,
  Stats,
  MutableSymbols as IMutableSymbols,
  Symbols as ISymbols,
} from '@parcel/types';
import type {Asset as AssetValue, ParcelOptions} from '../types';

import nullthrows from 'nullthrows';
import Environment from './Environment';
import Dependency from './Dependency';
import {Symbols, MutableAssetSymbols} from './Symbols';
import UncommittedAsset from '../UncommittedAsset';
import CommittedAsset from '../CommittedAsset';
import {createEnvironment} from '../Environment';

const inspect = Symbol.for('nodejs.util.inspect.custom');

const assetValueToAsset: WeakMap<AssetValue, Asset> = new WeakMap();
const assetValueToMutableAsset: WeakMap<
  AssetValue,
  MutableAsset,
> = new WeakMap();

const _assetToAssetValue: WeakMap<
  IAsset | IMutableAsset | BaseAsset,
  AssetValue,
> = new WeakMap();

const _mutableAssetToUncommittedAsset: WeakMap<
  IMutableAsset,
  UncommittedAsset,
> = new WeakMap();

export function assetToAssetValue(asset: IAsset | IMutableAsset): AssetValue {
  return nullthrows(_assetToAssetValue.get(asset));
}

export function mutableAssetToUncommittedAsset(
  mutableAsset: IMutableAsset,
): UncommittedAsset {
  return nullthrows(_mutableAssetToUncommittedAsset.get(mutableAsset));
}

export function assetFromValue(value: AssetValue, options: ParcelOptions) {
  return new Asset(
    value.committed
      ? new CommittedAsset(value, options)
      : new UncommittedAsset({
          value,
          options,
        }),
  );
}

class BaseAsset {
  #asset; // CommittedAsset | UncommittedAsset

  constructor(asset: CommittedAsset | UncommittedAsset) {
    this.#asset = asset;
    _assetToAssetValue.set(this, asset.value);
  }

  // $FlowFixMe
  [inspect]() {
    return `Asset(${this.filePath})`;
  }

  get id(): string {
    return this.#asset.value.id;
  }

  get type(): string {
    return this.#asset.value.type;
  }

  get env(): IEnvironment {
    return new Environment(this.#asset.value.env);
  }

  get fs(): FileSystem {
    return this.#asset.options.inputFS;
  }

  get filePath(): FilePath {
    return this.#asset.value.filePath;
  }

  get meta(): Meta {
    return this.#asset.value.meta;
  }

  get isIsolated(): boolean {
    return this.#asset.value.isIsolated;
  }

  get isInline(): boolean {
    return this.#asset.value.isInline;
  }

  get isSplittable(): ?boolean {
    return this.#asset.value.isSplittable;
  }

  get isSource(): boolean {
    return this.#asset.value.isSource;
  }

  get sideEffects(): boolean {
    return this.#asset.value.sideEffects;
  }

  get symbols(): ISymbols {
    return new Symbols(this.#asset.value);
  }

  get uniqueKey(): ?string {
    return this.#asset.value.uniqueKey;
  }

  get astGenerator(): ?ASTGenerator {
    return this.#asset.value.astGenerator;
  }

  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
    |},
  ): Promise<ConfigResult | null> {
    return this.#asset.getConfig(filePaths, options);
  }

  getIncludedFiles(): $ReadOnlyArray<File> {
    return this.#asset.getIncludedFiles();
  }

  getDependencies(): $ReadOnlyArray<IDependency> {
    return this.#asset.getDependencies().map(dep => new Dependency(dep));
  }

  getPackage(): Promise<PackageJSON | null> {
    return this.#asset.getPackage();
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
  #asset; // InternalAsset

  constructor(asset: CommittedAsset | UncommittedAsset) {
    let existing = assetValueToAsset.get(asset.value);
    if (existing != null) {
      return existing;
    }

    super(asset);
    this.#asset = asset;
    assetValueToAsset.set(asset.value, this);
  }

  get stats(): Stats {
    return this.#asset.value.stats;
  }
}

export class MutableAsset extends BaseAsset implements IMutableAsset {
  #asset; // InternalAsset

  constructor(asset: UncommittedAsset) {
    let existing = assetValueToMutableAsset.get(asset.value);
    if (existing != null) {
      return existing;
    }

    super(asset);
    this.#asset = asset;
    assetValueToMutableAsset.set(asset.value, this);
    _mutableAssetToUncommittedAsset.set(this, asset);
  }

  setMap(map: ?SourceMap): void {
    this.#asset.setMap(map);
  }

  get type(): string {
    return this.#asset.value.type;
  }

  set type(type: string): void {
    this.#asset.value.type = type;
  }

  get isIsolated(): boolean {
    return this.#asset.value.isIsolated;
  }

  set isIsolated(isIsolated: boolean): void {
    this.#asset.value.isIsolated = isIsolated;
  }

  get isInline(): boolean {
    return this.#asset.value.isInline;
  }

  set isInline(isInline: boolean): void {
    this.#asset.value.isInline = isInline;
  }

  get isSplittable(): ?boolean {
    return this.#asset.value.isSplittable;
  }

  set isSplittable(isSplittable: ?boolean): void {
    this.#asset.value.isSplittable = isSplittable;
  }

  get symbols(): IMutableSymbols {
    return new MutableAssetSymbols(this.#asset.value);
  }

  addDependency(dep: DependencyOptions): string {
    return this.#asset.addDependency(dep);
  }

  addIncludedFile(file: File): void {
    this.#asset.addIncludedFile(file);
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
      moduleSpecifier: url,
      isURL: true,
      isAsync: true, // The browser has native loaders for url dependencies
      ...opts,
    });
  }

  setEnvironment(env: EnvironmentOpts): void {
    this.#asset.value.env = createEnvironment(env);
  }
}
