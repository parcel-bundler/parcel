// @flow
import Config from './Config';
import loadParcelConfig from './loadParcelConfig';
import loadPlugin from './loadParcelPlugin';

export default class ConfigLoader {
  constructor(options) {
    this.options = options;
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

    let parcelConfig = await loadParcelConfig(filePath, this.options);

    config.setResolvedPath(parcelConfig.filePath);
    config.setResult(parcelConfig);
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
    plugin = await loadPlugin(plugin, parcelConfigPath);

    plugin.loadConfig && plugin.loadConfig(config);

    return config;
  }
}
