// @flow
import ConfigResolver from './ConfigResolver';
import {breakStatement} from 'babel-types';

export default class ConfigLoader {
  constructor(options) {
    this.options = options;
  }

  load(configRequest) {
    if (configRequest.configType === 'parcel') {
      return this.loadParcelConfig(configRequest);
    }

    return this.loadThirdPartyConfig(configRequest);
  }

  async loadParcelConfig(configRequest) {
    let {filePath} = configRequest;
    let configResolver = new ConfigResolver();
    let config = this.options.config
      ? await configResolver.create(this.options.config, filePath)
      : await configResolver.resolve(filePath);

    if (!config && this.options.defaultConfig) {
      config = await configResolver.create(
        this.options.defaultConfig,
        this.options.projectRoot
      );
    }

    if (!config) {
      throw new Error('Could not find a .parcelrc');
    }

    this.parcelConfig = config;

    let devDeps = [];
    switch (
      configRequest.meta.actionType // ? Don't know if I really like switch here
    ) {
      case 'transformer_request':
        devDeps = config.getTransformerNames(filePath);
        break;
      case 'dependency':
        devDeps = config.getResolverNames();
        break;
    }
    let devDepRequests = devDeps.map(devDep => ({
      moduleSpecifier: devDep,
      sourcePath: config.filePath
    }));

    let invalidatePatterns = [
      '**/.parcelrc',
      config.configPath,
      ...config.extendedFiles
    ];

    return {config, devDepRequests, invalidatePatterns};
  }

  loadThirdPartyConfig(configRequest) {
    throw new Error('Third party configuration loading not implemented yet');
  }
}
