// @flow
import type {FilePath, PackageName, Semver} from '@parcel/types';
import type {PackageManager} from '@parcel/package-manager';

import semver from 'semver';
import logger from '@parcel/logger';
import {CONFIG} from '@parcel/plugin';
import nullthrows from 'nullthrows';

const PARCEL_VERSION = require('../package.json').version;

export default async function loadPlugin<T>(
  packageManager: PackageManager,
  pluginName: PackageName,
  resolveFrom: FilePath,
  autoinstall: boolean,
): Promise<{|plugin: T, version: Semver|}> {
  let {resolved, pkg} = await packageManager.resolve(
    pluginName,
    `${resolveFrom}/index`,
    {autoinstall},
  );

  // Validate the engines.parcel field in the plugin's package.json
  let parcelVersionRange = pkg && pkg.engines && pkg.engines.parcel;
  if (!parcelVersionRange) {
    logger.warn({
      origin: '@parcel/core',
      message: `The plugin "${pluginName}" needs to specify a \`package.json#engines.parcel\` field with the supported Parcel version range.`,
    });
  }

  if (
    parcelVersionRange &&
    !semver.satisfies(PARCEL_VERSION, parcelVersionRange)
  ) {
    throw new Error(
      `The plugin "${pluginName}" is not compatible with the current version of Parcel. Requires "${parcelVersionRange}" but the current version is "${PARCEL_VERSION}".`,
    );
  }

  let plugin = await packageManager.require(resolved, `${resolveFrom}/index`, {
    autoinstall,
  });
  plugin = plugin.default ? plugin.default : plugin;
  if (!plugin) {
    throw new Error(`Plugin ${pluginName} has no exports.`);
  }
  plugin = plugin[CONFIG];
  if (!plugin) {
    throw new Error(
      `Plugin ${pluginName} is not a valid Parcel plugin, should export an instance of a Parcel plugin ex. "export default new Reporter({ ... })".`,
    );
  }
  return {plugin, version: nullthrows(pkg).version};
}
