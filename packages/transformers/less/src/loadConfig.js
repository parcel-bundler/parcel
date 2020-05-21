// @flow
import type {Config} from '@parcel/types';
import path from 'path';

export async function load({config}: {|config: Config|}) {
  let configFile: any = await config.getConfig(['.lessrc', '.lessrc.js'], {
    packageKey: 'less',
  });

  if (configFile === null) {
    configFile = {};
  }

  // Rewrites urls to be relative to the provided filename
  configFile.rewriteUrls = 'all';
  configFile.plugins = configFile.plugins || [];
  let isStatic =
    config.resolvedPath && path.extname(config.resolvedPath) !== '.js';

  if (!isStatic) {
    // This should enforce the config to be reloaded on every run as it's JS
    config.shouldInvalidateOnStartup();
    config.shouldReload();
  }

  return config.setResult({isStatic, config: configFile});
}

export function preSerialize(config: Config) {
  if (!config.result) return;

  // Ensure we dont pass functions to the serialiser
  if (!config.result.isStatic) {
    config.result.config = {};
  }
}
