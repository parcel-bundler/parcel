// @flow
import type {
  BuildMode,
  EnvMap,
  FilePath,
  LogLevel,
  PluginOptions as IPluginOptions,
  ServerOptions,
  HMROptions,
  DetailedReportOptions,
} from '@atlaspack/types';
import type {FileSystem} from '@atlaspack/fs';
import type {PackageManager} from '@atlaspack/package-manager';
import type {AtlaspackOptions} from '../types';
import {type FeatureFlags} from '@atlaspack/feature-flags';

let atlaspackOptionsToPluginOptions: WeakMap<AtlaspackOptions, PluginOptions> =
  new WeakMap();

export default class PluginOptions implements IPluginOptions {
  #options /*: AtlaspackOptions */;

  constructor(options: AtlaspackOptions): PluginOptions {
    let existing = atlaspackOptionsToPluginOptions.get(options);
    if (existing != null) {
      return existing;
    }

    this.#options = options;
    atlaspackOptionsToPluginOptions.set(options, this);
    return this;
  }

  get instanceId(): string {
    return this.#options.instanceId;
  }

  get mode(): BuildMode {
    return this.#options.mode;
  }

  get env(): EnvMap {
    return this.#options.env;
  }

  get atlaspackVersion(): string {
    return this.#options.atlaspackVersion;
  }

  get hmrOptions(): ?HMROptions {
    return this.#options.hmrOptions;
  }

  get serveOptions(): ServerOptions | false {
    return this.#options.serveOptions;
  }

  get shouldBuildLazily(): boolean {
    return this.#options.shouldBuildLazily;
  }

  get shouldAutoInstall(): boolean {
    return this.#options.shouldAutoInstall;
  }

  get logLevel(): LogLevel {
    return this.#options.logLevel;
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

  get detailedReport(): ?DetailedReportOptions {
    return this.#options.detailedReport;
  }

  get featureFlags(): FeatureFlags {
    return this.#options.featureFlags;
  }
}
