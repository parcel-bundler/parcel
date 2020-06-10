// @flow
import type {
  FilePath,
  Glob,
  Transformer,
  Resolver,
  Bundler,
  Namer,
  Runtime,
  EnvironmentContext,
  PackageName,
  Optimizer,
  Packager,
  Reporter,
  Semver,
  Validator,
} from '@parcel/types';
import type {PackageManager} from '@parcel/package-manager';
import type {
  ProcessedParcelConfig,
  ParcelPluginNode,
  PureParcelConfigPipeline,
  ExtendableParcelConfigPipeline,
} from './types';
import {isMatch} from 'micromatch';
import {basename} from 'path';
import loadPlugin from './loadParcelPlugin';

type GlobMap<T> = {[Glob]: T, ...};
type SerializedParcelConfig = {|
  $$raw: boolean,
  config: ProcessedParcelConfig,
  packageManager: PackageManager,
  autoinstall: boolean,
|};

export default class ParcelConfig {
  packageManager: PackageManager;
  filePath: FilePath;
  resolvers: PureParcelConfigPipeline;
  transformers: GlobMap<ExtendableParcelConfigPipeline>;
  bundler: ?ParcelPluginNode;
  namers: PureParcelConfigPipeline;
  runtimes: {[EnvironmentContext]: PureParcelConfigPipeline, ...};
  packagers: GlobMap<ParcelPluginNode>;
  validators: GlobMap<ExtendableParcelConfigPipeline>;
  optimizers: GlobMap<ExtendableParcelConfigPipeline>;
  reporters: PureParcelConfigPipeline;
  pluginCache: Map<PackageName, any>;
  autoinstall: boolean;

  constructor(
    config: ProcessedParcelConfig,
    packageManager: PackageManager,
    autoinstall: boolean,
  ) {
    this.packageManager = packageManager;
    this.filePath = config.filePath;
    this.resolvers = config.resolvers || [];
    this.transformers = config.transformers || {};
    this.runtimes = config.runtimes || {};
    this.bundler = config.bundler;
    this.namers = config.namers || [];
    this.packagers = config.packagers || {};
    this.optimizers = config.optimizers || {};
    this.reporters = config.reporters || [];
    this.validators = config.validators || {};
    this.pluginCache = new Map();
    this.autoinstall = autoinstall;
  }

  static deserialize(serialized: SerializedParcelConfig) {
    return new ParcelConfig(
      serialized.config,
      serialized.packageManager,
      serialized.autoinstall,
    );
  }

  getConfig(): ProcessedParcelConfig {
    return {
      filePath: this.filePath,
      resolvers: this.resolvers,
      transformers: this.transformers,
      validators: this.validators,
      runtimes: this.runtimes,
      bundler: this.bundler,
      namers: this.namers,
      packagers: this.packagers,
      optimizers: this.optimizers,
      reporters: this.reporters,
    };
  }

  serialize(): SerializedParcelConfig {
    return {
      $$raw: false,
      packageManager: this.packageManager,
      config: this.getConfig(),
      autoinstall: this.autoinstall,
    };
  }

  loadPlugin<T>(
    node: ParcelPluginNode,
  ): Promise<{|plugin: T, version: Semver|}> {
    let plugin = this.pluginCache.get(node.packageName);
    if (plugin) {
      return plugin;
    }

    plugin = loadPlugin<T>(
      this.packageManager,
      node.packageName,
      node.resolveFrom,
      this.autoinstall,
    );
    this.pluginCache.set(node.packageName, plugin);
    return plugin;
  }

  loadPlugins<T>(
    plugins: PureParcelConfigPipeline,
  ): Promise<
    Array<{|
      name: string,
      version: Semver,
      plugin: T,
      resolveFrom: FilePath,
    |}>,
  > {
    return Promise.all(
      plugins.map(async p => {
        let {plugin, version} = await this.loadPlugin<T>(p);
        return {
          name: p.packageName,
          plugin,
          version,
          resolveFrom: p.resolveFrom,
        };
      }),
    );
  }

  _getResolverNodes() {
    if (this.resolvers.length === 0) {
      throw new Error('No resolver plugins specified in .parcelrc config');
    }

    return this.resolvers;
  }

  getResolverNames(): Array<string> {
    return this._getResolverNodes().map(r => r.packageName);
  }

  getResolvers() {
    return this.loadPlugins<Resolver>(this._getResolverNodes());
  }

  _getValidatorNodes(filePath: FilePath): $ReadOnlyArray<ParcelPluginNode> {
    let validators: PureParcelConfigPipeline =
      this.matchGlobMapPipelines(filePath, this.validators) || [];

    return validators;
  }

  getValidatorNames(filePath: FilePath): Array<string> {
    let validators: PureParcelConfigPipeline = this._getValidatorNodes(
      filePath,
    );
    return validators.map(v => v.packageName);
  }

  getValidators(filePath: FilePath) {
    let validators = this._getValidatorNodes(filePath);
    return this.loadPlugins<Validator>(validators);
  }

  getNamedPipelines(): $ReadOnlyArray<string> {
    return Object.keys(this.transformers)
      .filter(glob => glob.includes(':'))
      .map(glob => glob.split(':')[0]);
  }

  _getTransformerNodes(
    filePath: FilePath,
    pipeline?: ?string,
  ): $ReadOnlyArray<ParcelPluginNode> {
    let transformers: PureParcelConfigPipeline | null = this.matchGlobMapPipelines(
      filePath,
      this.transformers,
      pipeline,
    );
    if (!transformers || transformers.length === 0) {
      throw new Error(`No transformers found for "${filePath}".`);
    }

    return transformers;
  }

  getTransformerNames(filePath: FilePath, pipeline?: ?string): Array<string> {
    let transformers = this._getTransformerNodes(filePath, pipeline);
    return transformers.map(t => t.packageName);
  }

  getTransformers(filePath: FilePath, pipeline?: ?string) {
    return this.loadPlugins<Transformer>(
      this._getTransformerNodes(filePath, pipeline),
    );
  }

  getBundlerName(): string {
    if (!this.bundler) {
      throw new Error('No bundler specified in .parcelrc config');
    }

    return this.bundler.packageName;
  }

  getBundler(): Promise<{|version: Semver, plugin: Bundler|}> {
    if (!this.bundler) {
      throw new Error('No bundler specified in .parcelrc config');
    }

    return this.loadPlugin<Bundler>(this.bundler);
  }

  getNamers() {
    if (this.namers.length === 0) {
      throw new Error('No namer plugins specified in .parcelrc config');
    }

    return this.loadPlugins<Namer>(this.namers);
  }

  getRuntimes(
    context: EnvironmentContext,
  ): Promise<
    Array<{|
      name: string,
      version: Semver,
      plugin: Runtime,
      resolveFrom: FilePath,
    |}>,
  > {
    let runtimes = this.runtimes[context];
    if (!runtimes) {
      return Promise.resolve([]);
    }

    return this.loadPlugins<Runtime>(runtimes);
  }

  _getPackagerNode(filePath: FilePath): ParcelPluginNode {
    let packagerName = this.matchGlobMap(filePath, this.packagers);
    if (!packagerName) {
      throw new Error(`No packager found for "${filePath}".`);
    }
    return packagerName;
  }

  getPackagerName(filePath: FilePath): string {
    return this._getPackagerNode(filePath).packageName;
  }

  async getPackager(
    filePath: FilePath,
  ): Promise<{|
    name: string,
    version: Semver,
    plugin: Packager,
  |}> {
    let packager = this._getPackagerNode(filePath);

    let {plugin, version} = await this.loadPlugin<Packager>(packager);
    return {
      name: packager.packageName,
      version,
      plugin,
    };
  }

  _getOptimizerNodes(filePath: FilePath, pipeline: ?string) {
    return (
      this.matchGlobMapPipelines(filePath, this.optimizers, pipeline) ?? []
    );
  }

  getOptimizerNames(filePath: FilePath, pipeline: ?string): Array<string> {
    let optimizers = this._getOptimizerNodes(filePath, pipeline);
    return optimizers.map(o => o.packageName);
  }

  getOptimizers(
    filePath: FilePath,
    pipeline: ?string,
  ): Promise<
    Array<{|
      name: string,
      version: Semver,
      plugin: Optimizer,
      resolveFrom: FilePath,
    |}>,
  > {
    let optimizers = this._getOptimizerNodes(filePath, pipeline);
    if (optimizers.length === 0) {
      return Promise.resolve([]);
    }

    return this.loadPlugins<Optimizer>(optimizers);
  }

  getReporters() {
    return this.loadPlugins<Reporter>(this.reporters);
  }

  isGlobMatch(filePath: FilePath, pattern: Glob, pipeline?: ?string) {
    let prefix = pipeline ? `${pipeline}:` : '';
    return (
      isMatch(prefix + filePath, pattern) ||
      isMatch(prefix + basename(filePath), pattern)
    );
  }

  matchGlobMap(filePath: FilePath, globMap: {[Glob]: any, ...}) {
    for (let pattern in globMap) {
      if (this.isGlobMatch(filePath, pattern)) {
        return globMap[pattern];
      }
    }

    return null;
  }

  matchGlobMapPipelines(
    filePath: FilePath,
    globMap: {[Glob]: ExtendableParcelConfigPipeline, ...},
    pipeline?: ?string,
  ): PureParcelConfigPipeline {
    let matches = [];
    for (let pattern in globMap) {
      if (this.isGlobMatch(filePath, pattern, pipeline)) {
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
          ...pipeline.slice(spreadIndex + 1),
        ];
      }

      if (pipeline.includes('...')) {
        throw new Error(
          'Only one spread parameter can be included in a config pipeline',
        );
      }

      return pipeline;
    };

    let res = flatten();
    // $FlowFixMe afaik this should work
    return res;
  }
}
