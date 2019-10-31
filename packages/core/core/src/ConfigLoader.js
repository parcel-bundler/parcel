// @flow

import type {ConfigRequest, ParcelOptions} from './types';
import type ParcelConfig from './ParcelConfig';

import nullthrows from 'nullthrows';
import {md5FromString, PromiseQueue} from '@parcel/utils';

import {createConfig} from './InternalConfig';
import Config from './public/Config';
import loadParcelConfig from './loadParcelConfig';
import loadPlugin from './loadParcelPlugin';

export default class ConfigLoader {
  options: ParcelOptions;
  parcelConfig: ParcelConfig;
  queue: PromiseQueue<any>;

  constructor(options: ParcelOptions) {
    this.options = options;
    this.queue = new PromiseQueue({maxConcurrent: 32});
  }

  load(configRequest: ConfigRequest) {
    let promise = this.queue.add(() => this._load(configRequest));
    this.queue.run();
    return promise;
  }

  _load(configRequest: ConfigRequest) {
    if (!configRequest.plugin) {
      return this.loadParcelConfig(configRequest);
    }

    return this.loadPluginConfig(configRequest);
  }

  async loadParcelConfig(configRequest: ConfigRequest) {
    let {filePath, isSource, env, pipeline} = configRequest;
    let config = createConfig({
      isSource,
      searchPath: filePath,
      env
    });
    let publicConfig = new Config(config, this.options);

    let {config: parcelConfig, extendedFiles} = nullthrows(
      await loadParcelConfig(filePath, this.options)
    );

    publicConfig.setResolvedPath(parcelConfig.filePath);
    publicConfig.setResult(parcelConfig.getConfig());
    this.parcelConfig = parcelConfig;

    let devDeps = [];
    switch (configRequest.meta.actionType) {
      case 'transformation':
        devDeps = parcelConfig.getTransformerNames(filePath, pipeline);
        break;
      case 'validation':
        devDeps = parcelConfig.getValidatorNames(filePath);
        break;
      case 'dependency':
        devDeps = parcelConfig.getResolverNames();
        break;
    }
    devDeps.forEach(devDep => publicConfig.addDevDependency(devDep));

    publicConfig.setResultHash(md5FromString(JSON.stringify(devDeps)));

    publicConfig.setWatchGlob('**/.parcelrc');

    // TODO: if extended config comes from a package, yarn.lock change should invalidate config request
    for (let extendedFile of extendedFiles) {
      publicConfig.addIncludedFile(extendedFile);
    }

    return config;
  }

  async loadPluginConfig({
    plugin,
    env,
    isSource,
    filePath,
    meta: {parcelConfigPath}
  }: ConfigRequest) {
    let config = createConfig({
      isSource,
      searchPath: filePath,
      env
    });

    plugin = await loadPlugin(
      this.options.packageManager,
      nullthrows(plugin),
      parcelConfigPath
    );
    if (plugin.loadConfig != null) {
      await plugin.loadConfig({
        config: new Config(config, this.options),
        options: this.options
      });
    }

    return config;
  }
}
