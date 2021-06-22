// @flow
import type {Config, PluginOptions} from '@parcel/types';
import {ParseConfigHost} from './ParseConfigHost';
import path from 'path';
import nullthrows from 'nullthrows';
import ts from 'typescript';

export async function loadTSConfig(
  config: Config,
  options: PluginOptions,
): any {
  let configResult = await config.getConfig(['tsconfig.json']);
  if (!configResult) {
    return;
  }

  let host = new ParseConfigHost(options.inputFS, ts);
  let parsedConfig = ts.parseJsonConfigFileContent(
    configResult.contents,
    host,
    path.dirname(nullthrows(configResult.filePath)),
  );

  // Add all of the extended config files to be watched
  for (let file of host.filesRead) {
    config.invalidateOnFileChange(path.resolve(file));
  }

  return parsedConfig.options;
}
