// @flow strict-local
// flowlint unsafe-getters-setters:off
import type {
  Config as IConfig,
  FilePath,
  Glob,
  PackageJSON,
  PackageName,
  ConfigResult,
} from '@parcel/types';
import Path from 'path';
import type {Config, ParcelOptions} from '../types';

import {DefaultWeakMap, loadConfig} from '@parcel/utils';

import Environment from './Environment';

const internalConfigToConfig: DefaultWeakMap<
  ParcelOptions,
  WeakMap<Config, PublicConfig>,
> = new DefaultWeakMap(() => new WeakMap());

const ROOT_FILES = new Set([
  'package.json',
  'yarn.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
]);

export default class PublicConfig implements IConfig {
  #config; // Config;
  #options; // ParcelOptions

  constructor(config: Config, options: ParcelOptions) {
    let existing = internalConfigToConfig.get(options).get(config);
    if (existing != null) {
      return existing;
    }

    this.#config = config;
    this.#options = options;
    internalConfigToConfig.get(options).set(config, this);
  }

  get env() {
    return new Environment(this.#config.env);
  }

  get searchPath() {
    return this.#config.searchPath;
  }

  get result() {
    return this.#config.result;
  }

  get isSource() {
    return this.#config.isSource;
  }

  get includedFiles() {
    return this.#config.includedFiles;
  }

  get rootDir() {
    if (this.#config.rootDir != null) {
      return this.#config.rootDir;
    }

    for (let filePath of this.includedFiles) {
      if (ROOT_FILES.has(Path.basename(filePath))) {
        this.#config.rootDir = Path.dirname(filePath);
      }
    }

    return this.#config.rootDir || this.#options.rootDir;
  }

  // $FlowFixMe
  setResult(result: any) {
    this.#config.result = result;
  }

  setResultHash(resultHash: string) {
    this.#config.resultHash = resultHash;
  }

  addIncludedFile(filePath: FilePath) {
    if (
      this.#config.rootDir != null &&
      ROOT_FILES.has(Path.basename(filePath))
    ) {
      this.#config.rootDir = null;
    }

    this.#config.includedFiles.add(filePath);
  }

  addDevDependency(name: PackageName, version?: string) {
    this.#config.devDeps.set(name, version);
  }

  setWatchGlob(glob: Glob) {
    this.#config.watchGlob = glob;
  }

  shouldRehydrate() {
    this.#config.shouldRehydrate = true;
  }

  shouldReload() {
    this.#config.shouldReload = true;
  }

  shouldInvalidateOnStartup() {
    this.#config.shouldInvalidateOnStartup = true;
  }

  async getConfigFrom(
    searchPath: FilePath,
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean,
    |},
  ): Promise<ConfigResult | null> {
    let packageKey = options && options.packageKey;
    if (packageKey != null) {
      let pkg = await this.getPackage();
      if (pkg && pkg[packageKey]) {
        return pkg[packageKey];
      }
    }

    let parse = options && options.parse;
    let conf = await loadConfig(
      this.#options.inputFS,
      searchPath,
      filePaths,
      parse == null ? null : {parse},
    );
    if (conf == null) {
      return null;
    }

    if (!options || !options.exclude) {
      this.addIncludedFile(conf.files[0].filePath);
    }

    return conf.config;
  }

  getConfig(
    filePaths: Array<FilePath>,
    options: ?{|
      packageKey?: string,
      parse?: boolean,
      exclude?: boolean,
    |},
  ): Promise<ConfigResult | null> {
    return this.getConfigFrom(this.searchPath, filePaths, options);
  }

  async getPackage(): Promise<PackageJSON | null> {
    if (this.#config.pkg) {
      return this.#config.pkg;
    }

    this.#config.pkg = await this.getConfig(['package.json']);
    return this.#config.pkg;
  }
}
