// @flow
import type {
  ResolvedParcelConfigFile,
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
  Optimizer,
  Reporter,
  Validator
} from '@parcel/types';
import {isMatch} from 'micromatch';
import {basename} from 'path';
import loadPlugin from './loadParcelPlugin';

type Pipeline = Array<PackageName>;
type GlobMap<T> = {[Glob]: T};

export default class ParcelConfig {
  filePath: FilePath;
  resolvers: Pipeline;
  transforms: GlobMap<Pipeline>;
  bundler: PackageName;
  namers: Pipeline;
  runtimes: {[EnvironmentContext]: Pipeline};
  packagers: GlobMap<PackageName>;
  validators: GlobMap<Pipeline>;
  optimizers: GlobMap<Pipeline>;
  reporters: Pipeline;
  pluginCache: Map<PackageName, any>;

  constructor(config: ResolvedParcelConfigFile) {
    this.filePath = config.filePath;
    this.resolvers = config.resolvers || [];
    this.transforms = config.transforms || {};
    this.runtimes = config.runtimes || {};
    this.bundler = config.bundler || '';
    this.namers = config.namers || [];
    this.packagers = config.packagers || {};
    this.optimizers = config.optimizers || {};
    this.reporters = config.reporters || [];
    this.validators = config.validators || {};
    this.pluginCache = new Map();
  }

  static deserialize(config: ResolvedParcelConfigFile) {
    return new ParcelConfig(config);
  }

  serialize(): ResolvedParcelConfigFile {
    return {
      filePath: this.filePath,
      resolvers: this.resolvers,
      transforms: this.transforms,
      validators: this.validators,
      runtimes: this.runtimes,
      bundler: this.bundler,
      namers: this.namers,
      packagers: this.packagers,
      optimizers: this.optimizers,
      reporters: this.reporters
    };
  }

  loadPlugin(pluginName: PackageName) {
    let plugin = this.pluginCache.get(pluginName);
    if (plugin) {
      return plugin;
    }

    plugin = loadPlugin(pluginName, this.filePath);
    this.pluginCache.set(pluginName, plugin);
    return plugin;
  }

  loadPlugins(plugins: Pipeline) {
    return Promise.all(plugins.map(pluginName => this.loadPlugin(pluginName)));
  }

  getResolverNames() {
    if (this.resolvers.length === 0) {
      throw new Error('No resolver plugins specified in .parcelrc config');
    }

    return this.resolvers;
  }

  getResolvers(): Promise<Array<Resolver>> {
    return this.loadPlugins(this.getResolverNames());
  }

  getValidatorNames(filePath: FilePath): Array<string> {
    let validators: Pipeline =
      this.matchGlobMapPipelines(filePath, this.validators) || [];

    return validators;
  }

  getTransformerNames(filePath: FilePath): Array<string> {
    let transformers: Pipeline | null = this.matchGlobMapPipelines(
      filePath,
      this.transforms
    );
    if (!transformers || transformers.length === 0) {
      throw new Error(`No transformers found for "${filePath}".`);
    }

    return transformers;
  }

  getValidators(filePath: FilePath): Promise<Array<Validator>> {
    return this.loadPlugins(this.getValidatorNames(filePath));
  }

  getTransformers(filePath: FilePath): Promise<Array<Transformer>> {
    return this.loadPlugins(this.getTransformerNames(filePath));
  }

  getBundler(): Promise<Bundler> {
    if (!this.bundler) {
      throw new Error('No bundler specified in .parcelrc config');
    }

    return this.loadPlugin(this.bundler);
  }

  getNamers(): Promise<Array<Namer>> {
    if (this.namers.length === 0) {
      throw new Error('No namer plugins specified in .parcelrc config');
    }

    return this.loadPlugins(this.namers);
  }

  getRuntimes(context: EnvironmentContext): Promise<Array<Runtime>> {
    let runtimes = this.runtimes[context];
    if (!runtimes) {
      return Promise.resolve([]);
    }

    return this.loadPlugins(runtimes);
  }

  getPackagerName(filePath: FilePath): string {
    let packagerName: ?PackageName = this.matchGlobMap(
      filePath,
      this.packagers
    );
    if (!packagerName) {
      throw new Error(`No packager found for "${filePath}".`);
    }
    return packagerName;
  }

  getPackager(filePath: FilePath): Promise<Packager> {
    let packagerName = this.getPackagerName(filePath);
    return this.loadPlugin(packagerName);
  }

  getOptimizerNames(filePath: FilePath): Array<string> {
    let optimizers: ?Pipeline = this.matchGlobMapPipelines(
      filePath,
      this.optimizers
    );
    if (!optimizers) {
      return [];
    }
    return optimizers;
  }

  getOptimizers(filePath: FilePath): Promise<Array<Optimizer>> {
    let optimizers = this.getOptimizerNames(filePath);
    if (optimizers.length === 0) {
      return Promise.resolve([]);
    }

    return this.loadPlugins(optimizers);
  }

  getReporters(): Promise<Array<Reporter>> {
    return this.loadPlugins(this.reporters);
  }

  isGlobMatch(filePath: FilePath, pattern: Glob) {
    return isMatch(filePath, pattern) || isMatch(basename(filePath), pattern);
  }

  matchGlobMap(filePath: FilePath, globMap: {[Glob]: any}) {
    for (let pattern in globMap) {
      if (this.isGlobMatch(filePath, pattern)) {
        return globMap[pattern];
      }
    }

    return null;
  }

  matchGlobMapPipelines(filePath: FilePath, globMap: {[Glob]: Pipeline}) {
    let matches = [];
    for (let pattern in globMap) {
      if (this.isGlobMatch(filePath, pattern)) {
        matches.push(globMap[pattern]);
      }
    }

    let flatten = () => {
      let pipeline = matches.shift() || [];
      let spreadIndex = pipeline.indexOf('...');
      if (spreadIndex >= 0) {
        pipeline = [
          ...pipeline.slice(0, spreadIndex),
          ...flatten(),
          ...pipeline.slice(spreadIndex + 1)
        ];
      }

      if (pipeline.includes('...')) {
        throw new Error(
          'Only one spread parameter can be included in a config pipeline'
        );
      }

      return pipeline;
    };

    let res = flatten();
    return res;
  }
}
