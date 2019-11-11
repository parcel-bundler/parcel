// @flow

import type {AssetRequest, Dependency, ParcelOptions} from './types';

import {PluginLogger} from '@parcel/logger';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
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

    for (let resolver of resolvers) {
      try {
        let result = await resolver.plugin.resolve({
          dependency: dep,
          options: this.pluginOptions,
          logger: new PluginLogger({origin: resolver.name})
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
            pipeline: dependency.pipeline
          };
        }
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, resolver.name)
        });
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
