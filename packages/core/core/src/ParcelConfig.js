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
  Optimizer,
  Reporter
} from '@parcel/types';
import {localResolve} from '@parcel/utils/src/localRequire';
import {isMatch} from 'micromatch';
import {basename, dirname} from 'path';
import {CONFIG} from '@parcel/plugin';
import logger from '@parcel/logger';
import semver from 'semver';
import loadPlugin from './loadParcelPlugin';

type Pipeline = Array<PackageName>;
type GlobMap<T> = {[Glob]: T};

const PARCEL_VERSION = require('../package.json').version;

export default class Config {
  filePath: FilePath;
  resolvers: Pipeline;
  transforms: GlobMap<Pipeline>;
  bundler: PackageName;
  namers: Pipeline;
  runtimes: {[EnvironmentContext]: Pipeline};
  packagers: GlobMap<PackageName>;
  optimizers: GlobMap<Pipeline>;
  reporters: Pipeline;
  pluginCache: Map<PackageName, any>;

  constructor(config: ParcelConfig) {
    this.filePath = config.filePath;
    this.resolveFrom = config.resolveFrom || dirname(config.filePath);
    this.extendedFiles = config.extendedFiles || [];
    this.resolvers = config.resolvers || [];
    this.transforms = config.transforms || {};
    this.runtimes = config.runtimes || {};
    this.bundler = config.bundler || '';
    this.namers = config.namers || [];
    this.packagers = config.packagers || {};
    this.optimizers = config.optimizers || {};
    this.reporters = config.reporters || [];
    this.pluginCache = new Map();
  }

  serialize(): ParcelConfig {
    return {
      resolveFrom: this.resolveFrom,
      resolvers: this.resolvers,
      transforms: this.transforms,
      runtimes: this.runtimes,
      bundler: this.bundler,
      namers: this.namers,
      packagers: this.packagers,
      optimizers: this.optimizers,
      reporters: this.reporters
    };
  }

  async loadPlugin(pluginName: PackageName) {
    return loadPlugin(pluginName, this.resolveFrom);
  }

  async loadPlugins(plugins: Pipeline) {
    return Promise.all(plugins.map(pluginName => this.loadPlugin(pluginName)));
  }

  getResolverNames() {
    return this.resolvers;
  }

  async getResolvers(): Promise<Array<Resolver>> {
    if (this.resolvers.length === 0) {
      throw new Error('No resolver plugins specified in .parcelrc config');
    }

    return this.loadPlugins(this.resolvers);
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

  async getTransformers(filePath: FilePath): Promise<Array<Transformer>> {
    let transformers = this.getTransformerNames(filePath);

    return this.loadPlugins(transformers);
  }

  async getBundler(): Promise<Bundler> {
    if (!this.bundler) {
      throw new Error('No bundler specified in .parcelrc config');
    }

    return this.loadPlugin(this.bundler);
  }

  async getNamers(): Promise<Array<Namer>> {
    if (this.namers.length === 0) {
      throw new Error('No namer plugins specified in .parcelrc config');
    }

    return this.loadPlugins(this.namers);
  }

  async getRuntimes(context: EnvironmentContext): Promise<Array<Runtime>> {
    let runtimes = this.runtimes[context];
    if (!runtimes) {
      return [];
    }

    return this.loadPlugins(runtimes);
  }

  async getPackager(filePath: FilePath): Promise<Packager> {
    let packagerName: ?PackageName = this.matchGlobMap(
      filePath,
      this.packagers
    );
    if (!packagerName) {
      throw new Error(`No packager found for "${filePath}".`);
    }

    return this.loadPlugin(packagerName);
  }

  async getOptimizers(filePath: FilePath): Promise<Array<Optimizer>> {
    let optimizers: ?Pipeline = this.matchGlobMapPipelines(
      filePath,
      this.optimizers
    );
    if (!optimizers) {
      return [];
    }

    return this.loadPlugins(optimizers);
  }

  async getReporters(): Promise<Array<Reporter>> {
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
