// @flow
import type {Config} from '@parcel/types';
import path from 'path';

export async function load({config}: {|config: Config|}) {
  let configFile: any = await config.getConfig(['.lessrc', '.lessrc.js'], {
    packageKey: 'less',
  });

  let configContents = {};
  if (configFile != null) {
    configContents = configFile.contents;
  }

  // Rewrites urls to be relative to the provided filename
  configContents.rewriteUrls = 'all';
  configContents.plugins = configContents.plugins || [];
  let isStatic = true;
  for (let f of config.includedFiles) {
    if (path.extname(f) === '.js') {
      isStatic = false;
    }
  }

  if (!isStatic) {
    // This should enforce the config to be reloaded on every run as it's JS
    config.shouldInvalidateOnStartup();
    config.shouldReload();
  }

  return config.setResult({isStatic, config: configContents});
}

export function preSerialize(config: Config) {
  if (!config.result) return;

  // Ensure we dont pass functions to the serialiser
  if (!config.result.isStatic) {
    config.result.config = {};
  }
}
