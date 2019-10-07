// @flow
import type {
  BuildMode,
  FilePath,
  LogLevel,
  PluginOptions as IPluginOptions,
  ServerOptions
} from '@parcel/types';
import type {FileSystem} from '@parcel/fs';
import type {PackageManager} from '@parcel/package-manager';
import type {ParcelOptions} from '../types';

export default class PluginOptions implements IPluginOptions {
  #options; // ParcelOptions

  constructor(options: ParcelOptions) {
    this.#options = options;
  }

  get mode(): BuildMode {
    return this.#options.mode;
  }

  get minify(): boolean {
    return this.#options.minify;
  }

  get scopeHoist(): boolean {
    return this.#options.scopeHoist;
  }

  get sourceMaps(): boolean {
    return this.#options.sourceMaps;
  }

  get env(): {+[string]: string, ...} {
    return this.#options.env;
  }

  get hot(): ServerOptions | false {
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

  get rootDir(): FilePath {
    return this.#options.rootDir;
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
}
