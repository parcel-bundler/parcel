// @flow
import type {
  ParcelConfig,
  FilePath,
  Glob,
  Transformer,
  Resolver,
  Bundler,
  Namer,
  Runtime,
  EnvironmentContext,
  PackageName,
  Packager,
  Optimizer
} from '@parcel/types';
import localRequire from '@parcel/utils/localRequire';
import {isMatch} from 'micromatch';
import {basename} from 'path';
import {CONFIG} from '@parcel/plugin';

export default class Config {
  config: ParcelConfig;
  configPath: FilePath;

  constructor(config: ParcelConfig, filePath: FilePath) {
    this.config = config;
    this.configPath = filePath;
  }

  async loadPlugin(pluginName: PackageName) {
    let plugin = await localRequire(pluginName, this.configPath);
    plugin = plugin.default ? plugin.default : plugin;
    return plugin[CONFIG];
  }

  async loadPlugins(plugins: Array<PackageName>) {
    return Promise.all(plugins.map(pluginName => this.loadPlugin(pluginName)));
  }

  async getResolvers(): Promise<Array<Resolver>> {
    return this.loadPlugins(this.config.resolvers);
  }

  async getTransformers(filePath: FilePath): Promise<Array<Transformer>> {
    let transformers: Array<PackageName> | null = this.matchGlobMap(
      filePath,
      this.config.transforms
    );
    if (!transformers) {
      throw new Error(`No transformers found for "${filePath}".`);
    }

    return this.loadPlugins(transformers);
  }

  async getBundler(): Promise<Bundler> {
    return this.loadPlugin(this.config.bundler);
  }

  async getNamers(): Promise<Array<Namer>> {
    return this.loadPlugins(this.config.namers);
  }

  async getRuntimes(context: EnvironmentContext): Promise<Array<Runtime>> {
    let runtimes = this.config.runtimes[context];
    if (!runtimes) {
      return [];
    }

    return await this.loadPlugins(runtimes);
  }

  async getPackager(filePath: FilePath): Promise<Packager> {
    let packagerName: PackageName | null = this.matchGlobMap(
      filePath,
      this.config.packagers
    );
    if (!packagerName) {
      throw new Error(`No packager found for "${filePath}".`);
    }

    return await this.loadPlugin(packagerName);
  }

  async getOptimizers(filePath: FilePath): Promise<Array<Optimizer>> {
    let optimizers: Array<PackageName> | null = this.matchGlobMap(
      filePath,
      this.config.optimizers
    );
    if (!optimizers) {
      return [];
    }

    return await this.loadPlugins(optimizers);
  }

  matchGlobMap(filePath: FilePath, globMap: {[Glob]: any}) {
    for (let pattern in globMap) {
      if (isMatch(filePath, pattern) || isMatch(basename(filePath), pattern)) {
        return globMap[pattern];
      }
    }

    return null;
  }
}
