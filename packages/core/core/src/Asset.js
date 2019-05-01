// @flow

import {Readable} from 'stream';

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
import TapStream from '@parcel/utils/src/TapStream';

type AssetOptions = {|
  id?: string,
  hash?: ?string,
  filePath: FilePath,
  type: string,
  content?: string | Readable,
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
  hash: ?string;
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
  content: string | Readable;
  contentKey: ?string;

  constructor(options: AssetOptions) {
    this.id =
      options.id ||
      md5FromString(
        options.filePath + options.type + JSON.stringify(options.env)
      );
    this.hash = options.hash;
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
      size: this.content instanceof Readable ? 0 : this.content.length
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
    this.readFromCacheIfKey();

    let content = this.content;
    if (typeof content === 'string') {
      return content;
    }

    this.content = (await bufferStream(content)).toString();
    return this.content;
  }

  async updateStats(): Promise<void> {
    let size = 0;
    this.outputHash = await md5FromReadableStream(
      this.getStream().pipe(
        new TapStream(buf => {
          size += buf.length;
        })
      )
    );
    this.stats.size = size;
  }

  async commit(): Promise<void> {
    this.ast = null;
    this.contentKey = await Cache.setStream(
      this.generateCacheKey('content'),
      this.getStream()
    );
  }

  getStream(): Readable {
    this.readFromCacheIfKey();

    if (this.content instanceof Readable) {
      return this.content;
    }

    return readableFromStringOrBuffer(this.content);
  }

  readFromCacheIfKey() {
    let contentKey = this.contentKey;
    if (contentKey) {
      this.content = Cache.getStream(contentKey);
    }
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

  createChildAsset(result: TransformerResult): Asset {
    let content = result.content || result.code || '';
    let asset = new Asset({
      hash: content === this.content ? this.hash : md5FromString(content),
      filePath: this.filePath,
      type: result.type,
      content,
      ast: result.ast,
      isIsolated: result.isIsolated,
      env: this.env.merge(result.env),
      dependencies: this.dependencies,
      connectedFiles: this.connectedFiles,
      meta: {...this.meta, ...result.meta}
    });

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

function readableFromStringOrBuffer(str: string | Buffer): Readable {
  // https://stackoverflow.com/questions/12755997/how-to-create-streams-from-string-in-node-js
  const stream = new Readable();
  stream.push(str);
  stream.push(null);
  return stream;
}

async function bufferStream(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.from([]);
    stream.on('data', data => {
      buf = Buffer.concat([buf, data]);
    });
    stream.on('end', () => {
      resolve(buf);
    });
    stream.on('error', reject);
  });
}
