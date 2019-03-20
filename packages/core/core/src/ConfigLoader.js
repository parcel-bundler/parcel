// @flow
import ConfigResolver from './ConfigResolver';
import PluginLoader from './PluginLoader';
import Config from './Config';
import {breakStatement} from 'babel-types';
import {conditionalExpression} from '@babel/types';

export default class ConfigLoader {
  constructor(options) {
    this.options = options;
    this.pluginLoader = new PluginLoader();
  }

  load(configRequest) {
    if (!configRequest.plugin) {
      return this.loadParcelConfig(configRequest);
    }

    return this.loadPluginConfig(configRequest);
  }

  async loadParcelConfig(configRequest) {
    let {filePath} = configRequest;
    let config = new Config(filePath);
    let configResolver = new ConfigResolver();

    // Resolve plugins from cwd when a config is passed programmatically
    let parcelConfig = this.options.parcelConfig
      ? await configResolver.create({
          ...this.options.parcelConfig,
          resolveFrom: this.options.cwd
        })
      : await configResolver.resolve(filePath);
    if (!parcelConfig && this.options.defaultConfig) {
      parcelConfig = await configResolver.create({
        ...this.options.defaultConfig,
        resolveFrom: this.options.cwd
      });
    }

    if (!parcelConfig) {
      throw new Error('Could not find a .parcelrc');
    }

    config.setResolvedPath(parcelConfig.filePath);
    config.setContent(parcelConfig);
    this.parcelConfig = parcelConfig;

    let devDeps = [];
    switch (configRequest.meta.actionType) {
      case 'transformation':
        devDeps = parcelConfig.getTransformerNames(filePath);
        break;
      case 'dependency':
        devDeps = parcelConfig.getResolverNames();
        break;
    }
    devDeps.forEach(devDep => config.setDevDep(devDep));

    config.addGlobWatchPattern('**/.parcelrc');

    let reliesOnLockFile = false;
    for (let extendedFile of parcelConfig.extendedFiles) {
      // ? Does this work for Windows
      if (extendedFile.includes('/node_modules/')) {
        reliesOnLockFile = true;
      }

      config.addIncludedFile(extendedFile);
    }

    if (reliesOnLockFile) {
      config.addInvalidatingFile(this.options.lockFilePath);
    }

    return config;
  }

  async loadPluginConfig({
    plugin,
    filePath,
    meta: {parcelConfigPath}
  }: ConfigRequest) {
    let config = new Config(filePath);
    plugin = await this.pluginLoader.load(plugin, parcelConfigPath);

    plugin.loadConfig && plugin.loadConfig(config);

    return config;
  }
}
