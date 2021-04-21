// @flow
import type {
  Async,
  Config as IConfig,
  FilePath,
  FileCreateInvalidation,
  PluginOptions as IPluginOptions,
} from '@parcel/types';
import type {Config, ParcelOptions} from '../types';
import type {LoadedPlugin} from '../ParcelConfig';
import type {RunAPI} from '../RequestTracker';

import crypto from 'crypto';
import v8 from 'v8';
import {PluginLogger} from '@parcel/logger';
import PluginOptions from '../public/PluginOptions';
import ThrowableDiagnostic, {errorToDiagnostic} from '@parcel/diagnostic';
import PublicConfig from '../public/Config';
import {optionsProxy} from '../utils';
import {getInvalidationHash} from '../assetUtils';

export type PluginWithLoadConfig = {
  loadConfig?: ({|
    config: IConfig,
    options: IPluginOptions,
    logger: PluginLogger,
  |}) => Async<void>,
  ...
};

export type ConfigRequest = {
  id: string,
  includedFiles: Set<FilePath>,
  invalidateOnFileCreate: Array<FileCreateInvalidation>,
  invalidateOnOptionChange: Set<string>,
  shouldInvalidateOnStartup: boolean,
  ...
};

export async function loadPluginConfig<T: PluginWithLoadConfig>(
  loadedPlugin: LoadedPlugin<T>,
  config: Config,
  options: ParcelOptions,
): Promise<void> {
  let loadConfig = loadedPlugin.plugin.loadConfig;
  if (!loadConfig) {
    return;
  }

  try {
    await loadConfig({
      config: new PublicConfig(config, options),
      options: new PluginOptions(
        optionsProxy(options, option => {
          config.invalidateOnOptionChange.add(option);
        }),
      ),
      logger: new PluginLogger({origin: loadedPlugin.name}),
    });
  } catch (e) {
    throw new ThrowableDiagnostic({
      diagnostic: errorToDiagnostic(e, {
        origin: loadedPlugin.name,
      }),
    });
  }
}

export async function runConfigRequest(
  api: RunAPI,
  configRequest: ConfigRequest,
) {
  let {
    includedFiles,
    invalidateOnFileCreate,
    invalidateOnOptionChange,
    shouldInvalidateOnStartup,
  } = configRequest;

  // If there are no invalidations, then no need to create a node.
  if (
    includedFiles.size === 0 &&
    invalidateOnFileCreate.length === 0 &&
    invalidateOnOptionChange.size === 0 &&
    !shouldInvalidateOnStartup
  ) {
    return;
  }

  await api.runRequest<null, void>({
    id: 'config_request:' + configRequest.id,
    type: 'config_request',
    run: ({api}) => {
      for (let filePath of includedFiles) {
        api.invalidateOnFileUpdate(filePath);
        api.invalidateOnFileDelete(filePath);
      }

      for (let invalidation of invalidateOnFileCreate) {
        api.invalidateOnFileCreate(invalidation);
      }

      for (let option of invalidateOnOptionChange) {
        api.invalidateOnOptionChange(option);
      }

      if (shouldInvalidateOnStartup) {
        api.invalidateOnStartup();
      }
    },
    input: null,
  });
}

export async function getConfigHash(
  config: Config,
  pluginName: string,
  options: ParcelOptions,
): Promise<string> {
  if (config.result == null) {
    return '';
  }

  let hash = crypto.createHash('md5');
  hash.update(config.id);

  // If there is no result hash set by the transformer, default to hashing the included
  // files if any, otherwise try to hash the config result itself.
  if (config.resultHash == null) {
    if (config.includedFiles.size > 0) {
      hash.update(
        await getInvalidationHash(
          [...config.includedFiles].map(filePath => ({
            type: 'file',
            filePath,
          })),
          options,
        ),
      );
    } else if (config.result != null) {
      try {
        // $FlowFixMe
        hash.update(v8.serialize(config.result));
      } catch (err) {
        throw new ThrowableDiagnostic({
          diagnostic: {
            message:
              'Config result is not hashable because it contains non-serializable objects. Please use config.setResultHash to set the hash manually.',
            origin: pluginName,
          },
        });
      }
    }
  } else {
    hash.update(config.resultHash ?? '');
  }

  return hash.digest('hex');
}
