// @flow
import semver from 'semver';

import {localResolve} from '@parcel/local-require';
import logger from '@parcel/logger';
import {CONFIG} from '@parcel/plugin';
import type {FilePath, PackageName} from '@parcel/types';

const PARCEL_VERSION = require('../package.json').version;

export default async function loadPlugin(
  pluginName: PackageName,
  resolveFrom: FilePath
) {
  let [resolved, pkg] = await localResolve(pluginName, `${resolveFrom}/index`);

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
