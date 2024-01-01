// @flow
import type {Config} from '@parcel/types';
import path from 'path';

type ConfigResult = {|
  config: any,
|};

export async function load({
  config,
}: {|
  config: Config,
|}): Promise<ConfigResult> {
  let configFile = await config.getConfig(
    ['.lessrc', '.lessrc.js', '.lessrc.cjs', '.lessrc.mjs'],
    {
      packageKey: 'less',
    },
  );

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

  return {config: configContents};
}
