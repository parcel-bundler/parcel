// @flow strict-local

import type {FilePath} from '@parcel/types';
import localRequire from '@parcel/local-require';

export default async function loadExternalPlugins(
  plugins: Array<string> | {+[pluginName: string]: mixed},
  relative: FilePath
): Promise<Array<mixed>> {
  if (Array.isArray(plugins)) {
    return Promise.all(
      plugins.map(p => loadPlugin(p, relative)).filter(Boolean)
    );
  } else if (typeof plugins === 'object') {
    let _plugins = plugins;
    let mapPlugins = await Promise.all(
      Object.keys(plugins).map(p => loadPlugin(p, relative, _plugins[p]))
    );
    return mapPlugins.filter(Boolean);
  } else {
    return [];
  }
}

async function loadPlugin(
  pluginName: string,
  relative: FilePath,
  options: mixed = {}
): mixed {
  let plugin = await localRequire(pluginName, relative);
  plugin = plugin.default || plugin;

  if (
    options != null &&
    typeof options === 'object' &&
    Object.keys(options).length > 0
  ) {
    plugin = plugin(options);
  }

  return plugin.default || plugin;
}
