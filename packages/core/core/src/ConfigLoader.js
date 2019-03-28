// @flow
import ConfigResolver from './ConfigResolver';
import {breakStatement} from 'babel-types';
import {conditionalExpression} from '@babel/types';

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

    // Resolve plugins from cwd when a config is passed programmatically
    let config = this.options.config
      ? await configResolver.create({
          ...this.options.config,
          resolveFrom: this.options.cwd
        })
      : await configResolver.resolve(filePath);
    if (!config && this.options.defaultConfig) {
      config = await configResolver.create({
        ...this.options.defaultConfig,
        resolveFrom: this.options.cwd
      });
    }

    if (!config) {
      throw new Error('Could not find a .parcelrc');
    }

    this.parcelConfig = config;

    let devDeps = [];
    switch (configRequest.meta.actionType) {
      case 'transformer_request':
        devDeps = config.getTransformerNames(filePath);
        break;
      case 'dependency':
        devDeps = config.getResolverNames();
        break;
    }
    let devDepRequests = devDeps.map(devDep => ({
      moduleSpecifier: devDep,
      resolveFrom: config.resolveFrom // TODO: resolveFrom should be nearest package boundary
    }));

    let invalidations = [
      {
        action: 'add',
        pattern: '**/.parcelrc'
      },
      {
        action: 'change',
        pattern: config.filePath
      },
      {
        action: 'unlink',
        pattern: config.filePath
      }
    ];

    let reliesOnLockFile = false;
    for (let extendedFile of config.extendedFiles) {
      // ? Does this work for Windows
      if (extendedFile.includes('/node_modules/')) {
        reliesOnLockFile = true;
      }
      invalidations.push({
        action: 'change',
        pattern: extendedFile
      });
    }

    // These are only needed for invalidations and do not need to be included in the hash
    // TODO: probably shouldn't get rid of them this way though
    delete config.extendedFiles;
    delete config.filePath;

    if (reliesOnLockFile) {
      invalidations.push({
        action: 'change',
        pattern: this.options.lockFilePath
      });
    }

    return {config, devDepRequests, invalidations};
  }

  loadThirdPartyConfig(configRequest) {
    throw new Error('Third party configuration loading not implemented yet');
    // TODO: Add config loader plugins to config and grab them programmatically based on config request
  }
}
