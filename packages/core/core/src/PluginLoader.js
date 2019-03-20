import {CONFIG} from '@parcel/plugin';
import {localResolve} from '@parcel/utils/src/localRequire';
import semver from 'semver';

const PARCEL_VERSION = require('../package.json').version;

export default class PluginLoader {
  constructor() {
    this.pluginCache = new Map();
  }

  async load(pluginName: PackageName, resolveFrom: FilePath) {
    // let cached = this.pluginCache.get(pluginName);
    // if (cached) {
    //   return cached;
    // }

    let [resolved, pkg] = await localResolve(
      pluginName,
      `${this.resolveFrom}/index`
    );

    // Validate the engines.parcel field in the plugin's package.json
    let parcelVersionRange = pkg && pkg.engines && pkg.engines.parcel;
    if (!parcelVersionRange) {
      logger.warn(
        `The plugin "${pluginName}" needs to specify a \`package.json#engines.parcel\` field with the supported Parcel version range.`
      );
    }

    if (
      parcelVersionRange &&
      !semver.satisfies(PARCEL_VERSION, parcelVersionRange)
    ) {
      throw new Error(
        `The plugin "${pluginName}" is not compatible with the current version of Parcel. Requires "${parcelVersionRange}" but the current version is "${PARCEL_VERSION}".`
      );
    }

    // $FlowFixMe
    let plugin = require(resolved);
    plugin = plugin.default ? plugin.default : plugin;
    plugin = plugin[CONFIG];
    // this.pluginCache.set(pluginName, plugin);
    return plugin;
  }
}
