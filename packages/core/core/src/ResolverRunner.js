// @flow

import type {
  CLIOptions,
  Dependency,
  ParcelConfig,
  Resolver
} from '@parcel/types';
import path from 'path';

type Options = {
  parcelConfig: ParcelConfig,
  cliOpts: CLIOptions,
  rootDir: string
};

type ResolverResult = null | string;

const getCacheKey = (filename, parent) =>
  (parent ? path.dirname(parent) : '') + ':' + filename;

export default class ResolverRunner {
  config: ParcelConfig;
  cliOpts: CLIOptions;
  cache: Map<string, ResolverResult>;
  rootDir: string;

  constructor({parcelConfig, cliOpts, rootDir}: Options) {
    this.config = parcelConfig;
    this.cliOpts = cliOpts;
    this.cache = new Map();
    this.rootDir = rootDir;
  }

  async resolve(dependency: Dependency): Promise<ResolverResult> {
    // Check the cache first
    console.log('Dependency', dependency);
    let key = getCacheKey(dependency.moduleSpecifier, dependency.sourcePath);
    let cached = this.cache.get(key);

    if (cached) {
      return cached;
    }

    for (let resolverModule of this.config.resolvers) {
      let resolver: Resolver = (require: Function)(resolverModule);
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
