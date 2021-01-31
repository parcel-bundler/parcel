// @flow

import type {Config, ConfigRequestDesc, ParcelOptions} from './types';
import type ParcelConfig from './ParcelConfig';

import invariant from 'assert';
import nullthrows from 'nullthrows';
import {md5FromString, PromiseQueue} from '@parcel/utils';
import {PluginLogger} from '@parcel/logger';
import path from 'path';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';

import {createConfig} from './InternalConfig';
import PublicConfig from './public/Config';

export default class ConfigLoader {
  options: ParcelOptions;
  parcelConfig: ParcelConfig;
  queue: PromiseQueue<any>;

  constructor({
    options,
    config,
  }: {|
    options: ParcelOptions,
    config: ParcelConfig,
  |}) {
    this.options = options;
    this.parcelConfig = config;
    this.queue = new PromiseQueue({maxConcurrent: 32});
  }

  load(configRequest: ConfigRequestDesc): Promise<Config> {
    let promise = this.queue.add(() => this._load(configRequest));
    this.queue.run().catch(() => {
      // Do nothing. Promises returned from `add` that will reject if the underlying
      // promise rejects.
    });
    return promise;
  }

  _load(configRequest: ConfigRequestDesc): Promise<Config> {
    if (!configRequest.plugin) {
      return Promise.resolve().then(() => this.loadParcelConfig(configRequest));
    }

    return this.loadPluginConfig(configRequest);
  }

  loadParcelConfig(configRequest: ConfigRequestDesc): Config {
    let {filePath, isSource, env, pipeline, isURL} = configRequest;
    let dir = isSource ? path.dirname(filePath) : this.options.projectRoot;
    let searchPath = path.join(dir, 'index');
    let config = createConfig({
      isSource,
      searchPath,
      env,
    });
    let publicConfig = new PublicConfig(config, this.options);
    publicConfig.addIncludedFile(this.parcelConfig.filePath);
    let devDeps = [];
    switch (configRequest.meta.actionType) {
      case 'transformation':
        devDeps = this.parcelConfig.getTransformerNames(
          filePath,
          pipeline,
          isURL,
        );
        break;
      case 'validation':
        devDeps = this.parcelConfig.getValidatorNames(filePath);
        break;
      case 'dependency':
        devDeps = this.parcelConfig.getResolverNames();
        break;
    }
    devDeps.forEach(devDep => publicConfig.addDevDependency(devDep));

    publicConfig.setResultHash(md5FromString(JSON.stringify(devDeps)));

    publicConfig.setWatchGlob('**/.parcelrc');

    // TODO: get included files from plugin nodes
    // TODO: if extended config comes from a package, yarn.lock change should invalidate config request

    return config;
  }

  async loadPluginConfig({
    plugin,
    env,
    isSource,
    filePath,
    meta: {parcelConfigPath, parcelConfigKeyPath},
  }: ConfigRequestDesc): Promise<Config> {
    let config = createConfig({
      isSource,
      searchPath: filePath,
      env,
    });

    invariant(typeof parcelConfigPath === 'string');
    invariant(typeof parcelConfigKeyPath === 'string');
    let packageName = nullthrows(plugin);
    let {plugin: pluginInstance} = await this.parcelConfig.loadPlugin({
      packageName,
      resolveFrom: parcelConfigPath,
      keyPath: parcelConfigKeyPath,
    });

    if (pluginInstance.loadConfig != null) {
      try {
        await pluginInstance.loadConfig({
          config: new PublicConfig(config, this.options),
          options: this.options,
          logger: new PluginLogger({origin: nullthrows(plugin)}),
        });
      } catch (e) {
        throw new ThrowableDiagnostic({
          diagnostic: errorToDiagnostic(e, packageName),
        });
      }
    }

    return config;
  }
}
