// @flow
import type {
  BuildMode,
  EnvMap,
  FilePath,
  LogLevel,
  PluginOptions as IPluginOptions,
  ServerOptions,
  HMROptions,
} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {PackageManager} from '@parcel/package-manager';
import type {ParcelOptions} from '../types';

let parcelOptionsToPluginOptions: WeakMap<
  ParcelOptions,
  PluginOptions,
> = new WeakMap();

export default class PluginOptions implements IPluginOptions {
  #options /*: ParcelOptions */;

  constructor(options: ParcelOptions): PluginOptions {
    let existing = parcelOptionsToPluginOptions.get(options);
    if (existing != null) {
      return existing;
    }

    this.#options = options;
    parcelOptionsToPluginOptions.set(options, this);
    return this;
  }

  get instanceId(): string {
    return this.#options.instanceId;
  }

  get mode(): BuildMode {
    return this.#options.mode;
  }

  get sourceMaps(): boolean {
    return this.#options.sourceMaps;
  }

  get env(): EnvMap {
    return this.#options.env;
  }

  get hot(): ?HMROptions {
    return this.#options.hot;
  }

  get serve(): ServerOptions | false {
    return this.#options.serve;
  }

  get autoinstall(): boolean {
    return this.#options.autoinstall;
  }

  get logLevel(): LogLevel {
    return this.#options.logLevel;
  }

  get entryRoot(): FilePath {
    return this.#options.entryRoot;
  }

  get distDir(): ?FilePath {
    return this.#options.distDir;
  }

  get cacheDir(): FilePath {
    // TODO: remove this. Probably bad if there are other types of caches.
    // Maybe expose the Cache object instead?
    return this.#options.cacheDir;
  }

  get projectRoot(): FilePath {
    return this.#options.projectRoot;
  }

  get inputFS(): FileSystem {
    return this.#options.inputFS;
  }

  get outputFS(): FileSystem {
    return this.#options.outputFS;
  }

  get packageManager(): PackageManager {
    return this.#options.packageManager;
  }

  get detailedReport(): number {
    return this.#options.detailedReport || 0;
  }
}
