// @flow

import type {
  Asset as IAsset,
  AST,
  Config,
  Dependency as IDependency,
  DependencyOptions,
  Environment,
  File,
  FilePath,
  Meta,
  PackageJSON,
  Stats,
  TransformerResult
} from '@parcel/types';

import {md5FromString, md5FromFilePath} from '@parcel/utils/src/md5';
import {loadConfig} from '@parcel/utils/src/config';
import Cache from '@parcel/cache';
import Dependency from './Dependency';

type AssetOptions = {|
  id?: string,
  hash?: string,
  filePath: FilePath,
  type: string,
  content?: string,
  contentKey?: ?string,
  ast?: ?AST,
  dependencies?: Iterable<[string, IDependency]>,
  connectedFiles?: Iterable<[FilePath, File]>,
  isIsolated?: boolean,
  outputHash?: string,
  env: Environment,
  meta?: Meta,
  stats?: Stats
|};

type SerializedOptions = {|
  ...AssetOptions,
  ...{|
    connectedFiles: Array<[FilePath, File]>,
    dependencies: Array<[string, IDependency]>
  |}
|};

export default class Asset implements IAsset {
  id: string;
  hash: string;
  filePath: FilePath;
  type: string;
  ast: ?AST;
  dependencies: Map<string, IDependency>;
  connectedFiles: Map<FilePath, File>;
  isIsolated: boolean;
  outputHash: string;
  env: Environment;
  meta: Meta;
  stats: Stats;
  content: string;
  contentKey: ?string;

  constructor(options: AssetOptions) {
    this.id =
      options.id ||
      md5FromString(
        options.filePath + options.type + JSON.stringify(options.env)
      );
    this.hash = options.hash || '';
    this.filePath = options.filePath;
    this.isIsolated = options.isIsolated == null ? false : options.isIsolated;
    this.type = options.type;
    this.content = options.content || '';
    this.contentKey = options.contentKey;
    this.ast = options.ast || null;
    this.dependencies = options.dependencies
      ? new Map(options.dependencies)
      : new Map();
    this.connectedFiles = options.connectedFiles
      ? new Map(options.connectedFiles)
      : new Map();
    this.outputHash = options.outputHash || '';
    this.env = options.env;
    this.meta = options.meta || {};
    this.stats = options.stats || {
      time: 0,
      size: this.content.length
    };
  }

  serialize(): SerializedOptions {
    // Exclude `code` and `ast` from cache
    return {
      id: this.id,
      hash: this.hash,
      filePath: this.filePath,
      type: this.type,
      dependencies: Array.from(this.dependencies),
      connectedFiles: Array.from(this.connectedFiles),
      isIsolated: this.isIsolated,
      outputHash: this.outputHash,
      env: this.env,
      meta: this.meta,
      stats: this.stats,
      contentKey: this.contentKey
    };
  }

  async getCode(): Promise<string> {
    if (this.contentKey) {
      let content = await Cache.get(this.contentKey);
      if (content == null) {
        throw new Error('Missing cache entry');
      }
      this.content = content;
    }
    return this.content;
  }

  async writeBlobs(): Promise<void> {
    this.contentKey = await Cache.set(
      this.generateCacheKey('content'),
      this.content
    );
  }

  generateCacheKey(key: string): string {
    return md5FromString(key + this.id + JSON.stringify(this.env));
  }

  addDependency(opts: DependencyOptions) {
    let {env, ...rest} = opts;
    let dep = new Dependency({
      ...rest,
      env: this.env.merge(env),
      sourcePath: this.filePath
    });

    this.dependencies.set(dep.id, dep);
    return dep.id;
  }

  async addConnectedFile(file: File) {
    if (!file.hash) {
      file.hash = await md5FromFilePath(file.filePath);
    }

    this.connectedFiles.set(file.filePath, file);
  }

  getConnectedFiles(): Array<File> {
    return Array.from(this.connectedFiles.values());
  }

  getDependencies(): Array<IDependency> {
    return Array.from(this.dependencies.values());
  }

  createChildAsset(result: TransformerResult) {
    let code = result.content || result.code || '';
    let opts: AssetOptions = {
      hash: this.hash || md5FromString(code),
      filePath: this.filePath,
      type: result.type,
      content: code,
      ast: result.ast,
      isIsolated: result.isIsolated,
      env: this.env.merge(result.env),
      dependencies: this.dependencies,
      connectedFiles: this.connectedFiles,
      meta: Object.assign({}, this.meta, result.meta)
    };

    let asset = new Asset(opts);

    let dependencies = result.dependencies;
    if (dependencies) {
      for (let dep of dependencies.values()) {
        asset.addDependency(dep);
      }
    }

    let connectedFiles = result.connectedFiles;
    if (connectedFiles) {
      for (let file of connectedFiles.values()) {
        asset.addConnectedFile(file);
      }
    }

    return asset;
  }

  async getConfig(
    filePaths: Array<FilePath>,
    options: ?{packageKey?: string, parse?: boolean}
  ): Promise<Config | null> {
    let packageKey = options && options.packageKey;
    let parse = options && options.parse;

    if (packageKey) {
      let pkg = await this.getPackage();
      if (pkg && pkg[packageKey]) {
        return pkg[packageKey];
      }
    }

    let conf = await loadConfig(
      this.filePath,
      filePaths,
      parse == null ? null : {parse}
    );
    if (!conf) {
      return null;
    }

    for (let file of conf.files) {
      this.addConnectedFile(file);
    }

    return conf.config;
  }

  async getPackage(): Promise<PackageJSON | null> {
    return this.getConfig(['package.json']);
  }
}
