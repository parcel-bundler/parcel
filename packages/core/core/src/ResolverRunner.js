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

  async resolve(dependency: Dependency): Promise<?AssetRequest> {
    let dep = new PublicDependency(dependency);
    report({
      type: 'buildProgress',
      phase: 'resolving',
      dependency: dep
    });

    let resolvers = await this.config.getResolvers();

    let pipeline;
    let filePath;
    if (dependency.moduleSpecifier.includes(':')) {
      [pipeline, filePath] = dependency.moduleSpecifier.split(':');
      let transformsWithPipelines = {};
      for (let key of Object.keys(this.config.transforms)) {
        if (key.includes(':')) {
          transformsWithPipelines[key] = this.config.transforms[key];
        }
      }

      if (
        !(
          this.config.matchGlobMapPipelines(
            filePath,
            transformsWithPipelines,
            pipeline
          )?.length > 0
        )
      ) {
        if (dep.isURL) {
          // This may be a url protocol or scheme rather than a pipeline, such as
          // `url('http://example.com/foo.png')`
          return null;
        } else {
          throw new Error(`Unknown pipeline ${pipeline}.`);
        }
      }
    } else {
      filePath = dependency.moduleSpecifier;
    }

    for (let resolver of resolvers) {
      let result = await resolver.resolve({
        filePath,
        dependency: dep,
        options: this.pluginOptions
      });

      if (result && result.isExcluded) {
        return null;
      }

      if (result && result.filePath) {
        return {
          filePath: result.filePath,
          sideEffects: result.sideEffects,
          code: result.code,
          env: dependency.env,
          pipeline: pipeline ?? dependency.pipeline
        };
      }
    }

    if (dep.isOptional) {
      return null;
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
