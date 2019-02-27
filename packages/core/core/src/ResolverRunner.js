// @flow

import type {CLIOptions, Dependency, FilePath} from '@parcel/types';
import path from 'path';
import Config from './Config';

type Opts = {|
  config: Config,
  cliOpts: CLIOptions,
  rootDir: string
|};

const getCacheKey = (filename, parent) =>
  (parent ? path.dirname(parent) : '') + ':' + filename;

export default class ResolverRunner {
  config: Config;
  cliOpts: CLIOptions;
  cache: Map<string, FilePath>;
  rootDir: string;

  constructor({config, cliOpts, rootDir}: Opts) {
    this.config = config;
    this.cliOpts = cliOpts;
    this.cache = new Map();
    this.rootDir = rootDir;
  }

  async resolve(dependency: Dependency): Promise<FilePath> {
    // Check the cache first
    let key = getCacheKey(dependency.moduleSpecifier, dependency.sourcePath);
    let cached = this.cache.get(key);

    if (cached) {
      return cached;
    }

    let resolvers = await this.config.getResolvers();

    for (let resolver of resolvers) {
      let result = await resolver.resolve(
        dependency,
        this.cliOpts,
        this.rootDir
      );

      if (result) {
        this.cache.set(key, result);

        return result;
      }
    }

    let dir = path.dirname(dependency.sourcePath);
    let err = new Error(
      `Cannot find module '${dependency.moduleSpecifier}' from '${dir}'`
    );

    (err: any).code = 'MODULE_NOT_FOUND';
    throw err;
  }
}
