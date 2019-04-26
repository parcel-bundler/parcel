// @flow

import type {
  Asset as IAsset,
  AssetOutput,
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
  code?: string,
  ast?: ?AST,
  dependencies?: Iterable<[string, IDependency]>,
  connectedFiles?: Iterable<[FilePath, File]>,
  isIsolated?: boolean,
  output?: AssetOutput,
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
  code: string;
  ast: ?AST;
  dependencies: Map<string, IDependency>;
  connectedFiles: Map<FilePath, File>;
  isIsolated: boolean;
  output: AssetOutput;
  outputHash: string;
  env: Environment;
  meta: Meta;
  stats: Stats;

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
    this.code = options.code || (options.output ? options.output.code : '');
    this.ast = options.ast || null;
    this.dependencies = options.dependencies
      ? new Map(options.dependencies)
      : new Map();
    this.connectedFiles = options.connectedFiles
      ? new Map(options.connectedFiles)
      : new Map();
    this.output = options.output || {code: this.code};
    this.outputHash = options.outputHash || '';
    this.env = options.env;
    this.meta = options.meta || {};
    this.stats = options.stats || {
      time: 0,
      size: this.output.code.length
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
      output: this.output,
      outputHash: this.outputHash,
      env: this.env,
      meta: this.meta,
      stats: this.stats
    };
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
    let code = (result.output && result.output.code) || result.code || '';
    let opts: AssetOptions = {
      hash: this.hash || md5FromString(code),
      filePath: this.filePath,
      type: result.type,
      code,
      ast: result.ast,
      isIsolated: result.isIsolated,
      env: this.env.merge(result.env),
      dependencies: this.dependencies,
      connectedFiles: this.connectedFiles,
      output: result.output,
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

  async getOutput() {
    await Cache.readBlobs(this);
    return this.output;
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
