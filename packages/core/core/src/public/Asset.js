// @flow strict-local
// flowlint unsafe-getters-setters:off

import type {Readable} from 'stream';

import type {
  Asset as IAsset,
  AST,
  Config,
  Dependency,
  DependencyOptions,
  Environment,
  File,
  FilePath,
  Meta,
  PackageJSON,
  SourceMap,
  Stats
} from '@parcel/types';

import type InternalAsset from '../Asset';

import nullthrows from 'nullthrows';

const _assetToInternalAsset: WeakMap<IAsset, InternalAsset> = new WeakMap();

export function assetToInternalAsset(asset: IAsset): InternalAsset {
  return nullthrows(_assetToInternalAsset.get(asset));
}

export default class Asset implements IAsset {
  #asset;

  constructor(asset: InternalAsset) {
    this.#asset = asset;
    _assetToInternalAsset.set(this, asset);
  }

  get id(): string {
    return this.#asset.id;
  }

  get ast(): ?AST {
    return this.#asset.ast;
  }

  set ast(ast: ?AST): void {
    this.#asset.ast = ast;
  }

  get type(): string {
    return this.#asset.type;
  }

  set type(type: string): void {
    this.#asset.type = type;
  }

  get env(): Environment {
    return this.#asset.env;
  }

  get filePath(): FilePath {
    return this.#asset.filePath;
  }

  get meta(): Meta {
    return this.#asset.meta;
  }

  get outputHash(): string {
    return this.#asset.outputHash;
  }

  get stats(): Stats {
    return this.#asset.stats;
  }

  get isIsolated(): boolean {
    return this.#asset.isIsolated;
  }

  set isIsolated(isIsolated: boolean): void {
    this.#asset.isIsolated = isIsolated;
  }

  addDependency(dep: DependencyOptions): string {
    return this.#asset.addDependency(dep);
  }

  addConnectedFile(file: File): Promise<void> {
    return this.#asset.addConnectedFile(file);
  }

  getConfig(
    filePaths: Array<FilePath>,
    options: ?{packageKey?: string, parse?: boolean}
  ): Promise<Config | null> {
    return this.#asset.getConfig(filePaths, options);
  }

  getConnectedFiles(): $ReadOnlyArray<File> {
    return this.#asset.getConnectedFiles();
  }

  getDependencies(): $ReadOnlyArray<Dependency> {
    return this.#asset.getDependencies();
  }

  getPackage(): Promise<PackageJSON | null> {
    return this.#asset.getPackage();
  }

  async getCode(): Promise<string> {
    return this.#asset.getCode();
  }

  async getBuffer(): Promise<Buffer> {
    return this.#asset.getBuffer();
  }

  getStream(): Readable {
    return this.#asset.getStream();
  }

  getMap(): Promise<?SourceMap> {
    return this.#asset.getMap();
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

  setMap(sourceMap: ?SourceMap): void {
    this.#asset.setMap(sourceMap);
  }
}
