// @flow
import type {Config, File, FilePath} from '@parcel/types';
import {loadConfig} from '@parcel/utils/src/config';
import WorkerFarm from '@parcel/workers';

type ConfigOutput = {
  config: Config,
  files?: Array<File>
};

type ConfigOptions = {
  parse?: boolean
};

type ConfigProviderOpts = {
  getConfig?: (
    sourcePath: FilePath,
    configFileName: FilePath
  ) => Promise<ConfigOutput> | ConfigOutput,
  overrideConfig?: (
    sourcePath: FilePath,
    configFileName: FilePath,
    config: Config
  ) => Promise<ConfigOutput> | ConfigOutput
};

export default class ConfigProvider {
  #opts;

  constructor(opts?: ConfigProviderOpts = {}) {
    this.#opts = opts;
  }

  serialize() {
    return {
      getConfig:
        this.#opts.getConfig && WorkerFarm.createHandle(this.#opts.getConfig),
      overrideConfig:
        this.#opts.overrideConfig &&
        WorkerFarm.createHandle(this.#opts.overrideConfig)
    };
  }

  async getConfig(
    sourcePath: FilePath,
    configFileNames: Array<FilePath>,
    options?: ConfigOptions
  ): Promise<?ConfigOutput> {
    if (this.#opts.getConfig) {
      for (let fileName of configFileNames) {
        let config = await this.#opts.getConfig(sourcePath, fileName);
        if (config != null) {
          return config;
        }
      }
    }

    let config = await loadConfig(sourcePath, configFileNames, options);
    if (!config) {
      return null;
    }

    if (this.#opts.overrideConfig) {
      let result = await this.#opts.overrideConfig(
        sourcePath,
        config.files[0].filePath,
        config.config
      );
      if (result != null) {
        return result;
      }
    }

    return config;
  }
}
