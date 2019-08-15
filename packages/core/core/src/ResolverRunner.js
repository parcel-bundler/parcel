// @flow

import type {AssetRequest, Dependency, ParcelOptions} from './types';
import path from 'path';
import type ParcelConfig from './ParcelConfig';
import {report} from './ReporterRunner';
import PublicDependency from './public/Dependency';
import PluginOptions from './public/PluginOptions';

type Opts = {|
  config: ParcelConfig,
  options: ParcelOptions
|};

export default class ResolverRunner {
  config: ParcelConfig;
  options: ParcelOptions;
  pluginOptions: PluginOptions;

  constructor({config, options}: Opts) {
    this.config = config;
    this.options = options;
    this.pluginOptions = new PluginOptions(this.options);
  }

  async resolve(dependency: Dependency): Promise<AssetRequest> {
    let dep = new PublicDependency(dependency);
    report({
      type: 'buildProgress',
      phase: 'resolving',
      dependency: dep
    });

    if (!dependency.sourcePath) {
      return {
        filePath: dependency.moduleSpecifier,
        env: dependency.env
      };
    }

    let resolvers = await this.config.getResolvers(dependency.sourcePath);

    for (let resolver of resolvers) {
      let result = await resolver.resolve({
        dependency: dep,
        options: this.pluginOptions
      });

      if (result) {
        return {
          ...result,
          env: dependency.env
        };
      }
    }

    let dir = dependency.sourcePath
      ? path.dirname(dependency.sourcePath)
      : '<none>';
    let err = new Error(
      `Cannot find module '${dependency.moduleSpecifier}' from '${dir}'`
    );

    (err: any).code = 'MODULE_NOT_FOUND';
    throw err;
  }
}
