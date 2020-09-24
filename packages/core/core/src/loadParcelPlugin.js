// @flow
import type {FilePath, PackageName, Semver} from '@parcel/types';
import type {PackageManager} from '@parcel/package-manager';
import type {PackageJSON} from '@parcel/types';
import semver from 'semver';
import logger from '@parcel/logger';
import {CONFIG} from '@parcel/plugin';
import nullthrows from 'nullthrows';
import ThrowableDiagnostic, {
  generateJSONCodeHighlights,
} from '@parcel/diagnostic';
import {findAlternativeNodeModules, resolveConfig} from '@parcel/utils';
import path from 'path';
import {version as PARCEL_VERSION} from '../package.json';

export async function resolvePlugin(
  packageManager: PackageManager,
  pluginName: PackageName,
  resolveFrom: FilePath,
  keyPath: string,
  autoinstall: boolean,
): Promise<{|resolved: FilePath, pkg?: ?PackageJSON|}> {
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
    let pkgFile = nullthrows(
      await resolveConfig(fs, resolved, ['package.json']),
    );
    let pkgContents = await fs.readFile(pkgFile, 'utf8');
    throw new ThrowableDiagnostic({
      diagnostic: {
        message: `The plugin "${pluginName}" is not compatible with the current version of Parcel. Requires "${parcelVersionRange}" but the current version is "${PARCEL_VERSION}".`,
        origin: '@parcel/core',
        filePath: pkgFile,
        language: 'json5',
        codeFrame: {
          code: pkgContents,
          codeHighlights: generateJSONCodeHighlights(pkgContents, [
            {
              key: '/engines/parcel',
            },
          ]),
        },
      },
    });
  }
  return {resolved, pkg};
}

export async function loadPlugin<T>(
  packageManager: PackageManager,
  pluginName: PackageName,
  resolveFrom: FilePath,
  autoinstall: boolean,
): Promise<{|plugin: T, version: Semver|}> {
  let {resolved, pkg} = await resolvePlugin(
    packageManager,
    pluginName,
    resolveFrom,
    autoinstall,
  );

  let plugin = await packageManager.require(resolved, resolveFrom, {
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
