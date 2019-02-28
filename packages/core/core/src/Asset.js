// @flow

import type {
  Asset as IAsset,
  TransformerResult,
  DependencyOptions,
  Dependency as IDependency,
  FilePath,
  File,
  Environment,
  JSONObject,
  AST,
  AssetOutput,
  Config,
  PackageJSON
} from '@parcel/types';
import {md5FromString, md5FromFilePath} from '@parcel/utils/src/md5';
import {loadConfig} from '@parcel/utils/lib/config';
import Cache from '@parcel/cache';
import Dependency from './Dependency';

type AssetOptions = {|
  id?: string,
  hash?: string,
  filePath: FilePath,
  type: string,
  code?: string,
  ast?: ?AST,
  dependencies?: Array<IDependency>,
  connectedFiles?: Array<File>,
  output?: AssetOutput,
  outputSize?: number,
  outputHash?: string,
  env: Environment,
  meta?: JSONObject
|};

export default class Asset implements IAsset {
  id: string;
  hash: string;
  filePath: FilePath;
  type: string;
  code: string;
  ast: ?AST;
  dependencies: Array<IDependency>;
  connectedFiles: Array<File>;
  output: AssetOutput;
  outputSize: number;
  outputHash: string;
  env: Environment;
  meta: JSONObject;

  constructor(options: AssetOptions) {
    this.id =
      options.id ||
      md5FromString(
        options.filePath + options.type + JSON.stringify(options.env)
      );
    this.hash = options.hash || '';
    this.filePath = options.filePath;
    this.type = options.type;
    this.code = options.code || (options.output ? options.output.code : '');
    this.ast = options.ast || null;
    this.dependencies = options.dependencies
      ? options.dependencies.slice()
      : [];
    this.connectedFiles = options.connectedFiles
      ? options.connectedFiles.slice()
      : [];
    this.output = options.output || {code: this.code};
    this.outputSize = options.outputSize || this.output.code.length;
    this.outputHash = options.outputHash || '';
    this.env = options.env;
    this.meta = options.meta || {};
  }

  serialize(): AssetOptions {
    // Exclude `code` and `ast` from cache
    return {
      id: this.id,
      hash: this.hash,
      filePath: this.filePath,
      type: this.type,
      dependencies: this.dependencies,
      connectedFiles: this.connectedFiles,
      output: this.output,
      outputSize: this.outputSize,
      outputHash: this.outputHash,
      env: this.env,
      meta: this.meta
    };
  }

  addDependency(opts: DependencyOptions) {
    // $FlowFixMe
    let dep = new Dependency({
      ...opts,
      env: this.env.merge(opts.env),
      sourcePath: this.filePath
    });
    this.dependencies.push(dep);
    return dep.id;
  }

  async addConnectedFile(file: File) {
    if (!file.hash) {
      file.hash = await md5FromFilePath(file.filePath);
    }

    this.connectedFiles.push(file);
  }

  createChildAsset(result: TransformerResult) {
    let code = (result.output && result.output.code) || result.code || '';
    let opts: AssetOptions = {
      hash: this.hash || md5FromString(code),
      filePath: this.filePath,
      type: result.type,
      code,
      ast: result.ast,
      env: this.env.merge(result.env),
      dependencies: this.dependencies,
      connectedFiles: this.connectedFiles,
      output: result.output,
      meta: Object.assign({}, this.meta, result.meta)
    };

    let asset = new Asset(opts);

    if (result.dependencies) {
      for (let dep of result.dependencies) {
        asset.addDependency(dep);
      }
    }

    if (result.connectedFiles) {
      for (let file of result.connectedFiles) {
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
    if (options && options.packageKey) {
      let pkg = await this.getPackage();
      if (pkg && options.packageKey && pkg[options.packageKey]) {
        return pkg[options.packageKey];
      }
    }

    let conf = await loadConfig(this.filePath, filePaths, options);
    if (!conf) {
      return null;
    }

    for (let file of conf.files) {
      this.addConnectedFile(file);
    }

    return conf.config;
  }

  async getPackage(): Promise<PackageJSON | null> {
    return await this.getConfig(['package.json']);
  }
}
