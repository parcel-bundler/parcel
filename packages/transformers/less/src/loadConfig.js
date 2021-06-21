// @flow
import type {Config} from '@parcel/types';
import path from 'path';

type ConfigResult = {|
  isStatic: boolean,
  config: any,
|};

export async function load({
  config,
}: {|
  config: Config,
|}): Promise<ConfigResult> {
  let configFile = await config.getConfig(['.lessrc', '.lessrc.js'], {
    packageKey: 'less',
  });

  let configContents = {};
  if (configFile != null) {
    configContents = configFile.contents;

    // Resolve relative paths from config file
    if (configContents.paths) {
      configContents.paths = configContents.paths.map(p =>
        path.resolve(path.dirname(configFile.filePath), p),
      );
    }
  }

  // Rewrites urls to be relative to the provided filename
  configContents.rewriteUrls = 'all';
  configContents.plugins = configContents.plugins || [];

  // This should enforce the config to be reloaded on every run as it's JS
  let isDynamic = configFile && path.extname(configFile.filePath) === '.js';
  if (isDynamic) {
    config.invalidateOnStartup();
  }

  return {isStatic: !isDynamic, config: configContents};
}
