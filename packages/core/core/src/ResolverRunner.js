// @flow

import type {
  ParcelOptions,
  Dependency,
  TransformerRequest
} from '@parcel/types';
import path from 'path';
import Config from './Config';
import {report} from './ReporterRunner';

type Opts = {
  config: Config,
  options: ParcelOptions,
  rootDir: string
};

const getCacheKey = (filename, parent) =>
  (parent ? path.dirname(parent) : '') + ':' + filename;

export default class ResolverRunner {
  config: Config;
  options: ParcelOptions;
  cache: Map<string, TransformerRequest>;
  rootDir: string;

  constructor({config, options, rootDir}: Opts) {
    this.config = config;
    this.options = options;
    this.cache = new Map();
    this.rootDir = rootDir;
  }

  async resolve(dependency: Dependency): Promise<TransformerRequest> {
    report({
      type: 'buildProgress',
      phase: 'resolving',
      dependency
    });

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
        this.options,
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
