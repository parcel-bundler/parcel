// @flow strict-local
// flowlint unsafe-getters-setters:off

import type SourceMap from '@parcel/source-map';
import type {Readable} from 'stream';
import type {FileSystem} from '@parcel/fs';

import type {
  Asset as IAsset,
  AST,
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
  Symbol,
} from '@parcel/types';
import type {Asset as AssetValue, ParcelOptions} from '../types';

import nullthrows from 'nullthrows';
import Environment from './Environment';
import Dependency from './Dependency';
import InternalAsset from '../InternalAsset';
import {createEnvironment} from '../Environment';

const assetValueToAsset: WeakMap<AssetValue, Asset> = new WeakMap();
const assetValueToMutableAsset: WeakMap<
  AssetValue,
  MutableAsset,
> = new WeakMap();

const _assetToInternalAsset: WeakMap<
  IAsset | IMutableAsset | BaseAsset,
  InternalAsset,
> = new WeakMap();

export function assetToInternalAsset(
  asset: IAsset | IMutableAsset,
): InternalAsset {
  return nullthrows(_assetToInternalAsset.get(asset));
}

export function assetFromValue(value: AssetValue, options: ParcelOptions) {
  return new Asset(
    new InternalAsset({
      value,
      options,
    }),
  );
}

class BaseAsset {
  #asset; // InternalAsset

  constructor(asset: InternalAsset) {
    this.#asset = asset;
    _assetToInternalAsset.set(this, asset);
  }

  get id(): string {
    return this.#asset.value.id;
  }

  get ast(): ?AST {
    return this.#asset.ast;
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

  get symbols(): Map<Symbol, Symbol> {
    return this.#asset.value.symbols;
  }

  get uniqueKey(): ?string {
    return this.#asset.value.uniqueKey;
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
}

export class Asset extends BaseAsset implements IAsset {
  #asset; // InternalAsset

  constructor(asset: InternalAsset) {
    let existing = assetValueToAsset.get(asset.value);
    if (existing != null) {
      return existing;
    }

    super(asset);
    this.#asset = asset;
    assetValueToAsset.set(asset.value, this);
  }

  get outputHash(): string {
    return this.#asset.value.outputHash;
  }

  get stats(): Stats {
    return this.#asset.value.stats;
  }
}

export class MutableAsset extends BaseAsset implements IMutableAsset {
  #asset; // InternalAsset

  constructor(asset: InternalAsset) {
    let existing = assetValueToMutableAsset.get(asset.value);
    if (existing != null) {
      return existing;
    }

    super(asset);
    this.#asset = asset;
    assetValueToMutableAsset.set(asset.value, this);
  }

  get ast(): ?AST {
    return this.#asset.ast;
  }

  set ast(ast: ?AST): void {
    this.#asset.ast = ast;
  }

  setMap(map: ?SourceMap): void {
    this.#asset.map = map;
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

  addDependency(dep: DependencyOptions): string {
    return this.#asset.addDependency(dep);
  }

  addIncludedFile(file: File) {
    return this.#asset.addIncludedFile(file);
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
