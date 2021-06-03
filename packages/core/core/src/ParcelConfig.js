// @flow
import type {
  FilePath,
  Glob,
  Transformer,
  Resolver,
  Bundler,
  Namer,
  Runtime,
  PackageName,
  Optimizer,
  Packager,
  Reporter,
  Semver,
  Validator,
} from '@parcel/types';
import type {
  ProcessedParcelConfig,
  ParcelPluginNode,
  PureParcelConfigPipeline,
  ExtendableParcelConfigPipeline,
  ParcelOptions,
} from './types';
import {makeRe} from 'micromatch';
import {basename} from 'path';
import loadPlugin from './loadParcelPlugin';

type GlobMap<T> = {[Glob]: T, ...};
type SerializedParcelConfig = {|
  $$raw: boolean,
  config: ProcessedParcelConfig,
  options: ParcelOptions,
|};

export type LoadedPlugin<T> = {|
  name: string,
  version: Semver,
  plugin: T,
  resolveFrom: FilePath,
  keyPath?: string,
|};

export default class ParcelConfig {
  options: ParcelOptions;
  filePath: FilePath;
  resolvers: PureParcelConfigPipeline;
  transformers: GlobMap<ExtendableParcelConfigPipeline>;
  bundler: ?ParcelPluginNode;
  namers: PureParcelConfigPipeline;
  runtimes: PureParcelConfigPipeline;
  packagers: GlobMap<ParcelPluginNode>;
  validators: GlobMap<ExtendableParcelConfigPipeline>;
  optimizers: GlobMap<ExtendableParcelConfigPipeline>;
  reporters: PureParcelConfigPipeline;
  pluginCache: Map<PackageName, any>;
  regexCache: Map<string, RegExp>;

  constructor(config: ProcessedParcelConfig, options: ParcelOptions) {
    this.options = options;
    this.filePath = config.filePath;
    this.resolvers = config.resolvers || [];
    this.transformers = config.transformers || {};
    this.runtimes = config.runtimes || [];
    this.bundler = config.bundler;
    this.namers = config.namers || [];
    this.packagers = config.packagers || {};
    this.optimizers = config.optimizers || {};
    this.reporters = config.reporters || [];
    this.validators = config.validators || {};
    this.pluginCache = new Map();
    this.regexCache = new Map();
  }

  static deserialize(serialized: SerializedParcelConfig): ParcelConfig {
    return new ParcelConfig(serialized.config, serialized.options);
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
      config: this.getConfig(),
      options: this.options,
    };
  }

  _loadPlugin<T>(
    node: ParcelPluginNode,
  ): Promise<{|plugin: T, version: Semver, resolveFrom: FilePath|}> {
    let plugin = this.pluginCache.get(node.packageName);
    if (plugin) {
      return plugin;
    }

    plugin = loadPlugin<T>(
      node.packageName,
      node.resolveFrom,
      node.keyPath,
      this.options,
    );

    this.pluginCache.set(node.packageName, plugin);
    return plugin;
  }

  async loadPlugin<T>(node: ParcelPluginNode): Promise<LoadedPlugin<T>> {
    let plugin = await this._loadPlugin(node);
    return {
      ...plugin,
      name: node.packageName,
      keyPath: node.keyPath,
    };
  }

  invalidatePlugin(packageName: PackageName) {
    this.pluginCache.delete(packageName);
  }

  loadPlugins<T>(
    plugins: PureParcelConfigPipeline,
  ): Promise<Array<LoadedPlugin<T>>> {
    return Promise.all(plugins.map(p => this.loadPlugin<T>(p)));
  }

  _getResolverNodes(): PureParcelConfigPipeline {
    if (this.resolvers.length === 0) {
      throw new Error('No resolver plugins specified in .parcelrc config');
    }

    return this.resolvers;
  }

  getResolverNames(): Array<string> {
    return this._getResolverNodes().map(r => r.packageName);
  }

  getResolvers(): Promise<Array<LoadedPlugin<Resolver>>> {
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

  getValidators(filePath: FilePath): Promise<Array<LoadedPlugin<Validator>>> {
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
    allowEmpty?: boolean,
  ): $ReadOnlyArray<ParcelPluginNode> {
    let transformers: PureParcelConfigPipeline | null = this.matchGlobMapPipelines(
      filePath,
      this.transformers,
      pipeline,
    );
    if (!transformers || transformers.length === 0) {
      if (allowEmpty) {
        return [];
      }

      throw new Error(
        `No transformers found for ${filePath}` +
          (pipeline != null ? ` with pipeline: '${pipeline}'` : '') +
          '.',
      );
    }

    return transformers;
  }

  getTransformerNames(
    filePath: FilePath,
    pipeline?: ?string,
    allowEmpty?: boolean,
  ): Array<string> {
    let transformers = this._getTransformerNodes(
      filePath,
      pipeline,
      allowEmpty,
    );
    return transformers.map(t => t.packageName);
  }

  getTransformers(
    filePath: FilePath,
    pipeline?: ?string,
    allowEmpty?: boolean,
  ): Promise<Array<LoadedPlugin<Transformer>>> {
    return this.loadPlugins<Transformer>(
      this._getTransformerNodes(filePath, pipeline, allowEmpty),
    );
  }

  getBundlerName(): string {
    if (!this.bundler) {
      throw new Error('No bundler specified in .parcelrc config');
    }

    return this.bundler.packageName;
  }

  getBundler(): Promise<LoadedPlugin<Bundler>> {
    if (!this.bundler) {
      throw new Error('No bundler specified in .parcelrc config');
    }

    return this.loadPlugin<Bundler>(this.bundler);
  }

  getNamers(): Promise<Array<LoadedPlugin<Namer>>> {
    if (this.namers.length === 0) {
      throw new Error('No namer plugins specified in .parcelrc config');
    }

    return this.loadPlugins<Namer>(this.namers);
  }

  getRuntimes(): Promise<Array<LoadedPlugin<Runtime>>> {
    if (!this.runtimes) {
      return Promise.resolve([]);
    }

    return this.loadPlugins<Runtime>(this.runtimes);
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

  _getOptimizerNodes(
    filePath: FilePath,
    pipeline: ?string,
  ): PureParcelConfigPipeline {
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
  ): Promise<Array<LoadedPlugin<Optimizer>>> {
    let optimizers = this._getOptimizerNodes(filePath, pipeline);
    if (optimizers.length === 0) {
      return Promise.resolve([]);
    }

    return this.loadPlugins<Optimizer>(optimizers);
  }

  getReporters(): Promise<Array<LoadedPlugin<Reporter>>> {
    return this.loadPlugins<Reporter>(this.reporters);
  }

  isGlobMatch(filePath: FilePath, pattern: Glob, pipeline?: ?string): boolean {
    let [patternPipeline, patternGlob] = pattern.split(':');
    if (!patternGlob) {
      patternGlob = patternPipeline;
      patternPipeline = null;
    }

    let re = this.regexCache.get(patternGlob);
    if (!re) {
      re = makeRe(patternGlob, {dot: true});
      this.regexCache.set(patternGlob, re);
    }

    return (
      (pipeline === patternPipeline || (!pipeline && !patternPipeline)) &&
      (re.test(filePath) || re.test(basename(filePath)))
    );
  }

  matchGlobMap<T>(filePath: FilePath, globMap: {|[Glob]: T|}): ?T {
    for (let pattern in globMap) {
      if (this.isGlobMatch(filePath, pattern)) {
        return globMap[pattern];
      }
    }

    return null;
  }

  matchGlobMapPipelines(
    filePath: FilePath,
    globMap: {|[Glob]: ExtendableParcelConfigPipeline|},
    pipeline?: ?string,
  ): PureParcelConfigPipeline {
    let matches = [];
    if (pipeline) {
      // If a pipeline is requested, a the glob needs to match exactly
      let exactMatch;
      for (let pattern in globMap) {
        if (this.isGlobMatch(filePath, pattern, pipeline)) {
          exactMatch = globMap[pattern];
          break;
        }
      }
      if (!exactMatch) {
        return [];
      } else {
        matches.push(exactMatch);
      }
    }

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
