// @flow
import type {Config, PluginOptions} from '@parcel/types';
import typeof TypeScriptModule from 'typescript'; // eslint-disable-line import/no-extraneous-dependencies
import {ParseConfigHost} from './ParseConfigHost';
import path from 'path';
import nullthrows from 'nullthrows';

export async function loadTSConfig(config: Config, options: PluginOptions) {
  let configResult = await config.getConfig(['tsconfig.json']);
  if (!configResult) {
    return;
  }

  let ts: TypeScriptModule = await options.packageManager.require(
    'typescript',
    config.searchPath,
    {shouldAutoInstall: options.shouldAutoInstall},
  );

  let host = new ParseConfigHost(options.inputFS, ts);
  let parsedConfig = ts.parseJsonConfigFileContent(
    configResult.contents,
    host,
    path.dirname(nullthrows(configResult.filePath)),
  );

  // Add all of the extended config files to be watched
  for (let file of host.filesRead) {
    config.addIncludedFile(path.resolve(file));
  }

  config.setResult(parsedConfig.options);
}
