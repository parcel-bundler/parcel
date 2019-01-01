// @flow
import type {
  Asset as IAsset,
  TransformerResult,
  DependencyOptions,
  Dependency,
  FilePath,
  File,
  Environment,
  JSONObject,
  AST,
  AssetOutput,
  Config,
  PackageJSON
} from '@parcel/types';
import type Cache from '@parcel/cache';
import md5 from '@parcel/utils/md5';
import {loadConfig} from '@parcel/utils/config';
import createDependency from './createDependency';

type AssetOptions = {
  id?: string,
  hash?: string,
  filePath: FilePath,
  type: string,
  code?: string,
  ast?: ?AST,
  dependencies?: Array<Dependency>,
  connectedFiles?: Array<File>,
  output?: AssetOutput,
  outputHash?: string,
  env: Environment,
  meta?: JSONObject,
  cache?: Cache
};

export default class Asset implements IAsset {
  id: string;
  hash: string;
  filePath: FilePath;
  type: string;
  code: string;
  ast: ?AST;
  dependencies: Array<Dependency>;
  connectedFiles: Array<File>;
  output: AssetOutput;
  outputSize: number;
  outputHash: string;
  env: Environment;
  meta: JSONObject;
  #cache; // no type annotation because prettier dies...

  constructor(options: AssetOptions) {
    this.id =
      options.id ||
      md5(options.filePath + options.type + JSON.stringify(options.env));
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
    this.outputSize = this.output.code.length;
    this.outputHash = options.outputHash || '';
    this.env = options.env;
    this.meta = options.meta || {};
    this.#cache = options.cache;
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
    let dep = createDependency(
      {
        ...opts,
        env: mergeEnvironment(this.env, opts.env)
      },
      this.filePath
    );

    this.dependencies.push(dep);
    return dep.id;
  }

  async addConnectedFile(file: File) {
    if (!file.hash) {
      file.hash = await md5.file(file.filePath);
    }

    this.connectedFiles.push(file);
  }

  createChildAsset(result: TransformerResult) {
    let code = (result.output && result.output.code) || result.code || '';
    let opts: AssetOptions = {
      hash: this.hash || md5(code),
      filePath: this.filePath,
      type: result.type,
      code,
      ast: result.ast,
      env: mergeEnvironment(this.env, result.env),
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
    if (this.#cache) {
      await this.#cache.readBlobs(this);
      this.#cache = null;
    }

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

function mergeEnvironment(a: Environment, b: ?Environment): Environment {
  return Object.assign({}, a, b);
}
