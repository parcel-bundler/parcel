// @flow strict-local
/* eslint-disable no-console */

// $FlowFixMe[untyped-import]
import {version} from '../package.json';
import {ParcelLinkConfig} from './ParcelLinkConfig';
import {link} from './link';
import {unlink} from './unlink';

import commander from 'commander';
import path from 'path';

export function createProgram(): commander.Command {
  const program = new commander.Command();

  program
    .version(version, '-V, --version')
    .description('A tool for linking a dev copy of Parcel into an app')
    .addHelpText('after', `\nThe link command is the default command.`);

  program
    .command('link [packageRoot]')
    .description('Link a dev copy of Parcel into an app', {
      packageRoot:
        'Path to the Parcel package root\nDefaults to the package root containing this package',
    })
    .option('-d, --dry-run', 'Do not write any changes')
    .option('-n, --namespace <namespace>', 'Namespace for packages', '@parcel')
    .option(
      '-g, --node-modules-globs <globs...>',
      'Locations where node_modules should be linked in the app',
      'node_modules',
    )
    .action(async (packageRoot, options) => {
      if (options.dryRun) console.log('Dry run...');
      let appRoot = process.cwd();

      let parcelLinkConfig;

      try {
        parcelLinkConfig = await ParcelLinkConfig.load(appRoot);
      } catch (e) {
        // boop!
      }

      if (parcelLinkConfig) {
        console.error(
          'A Parcel link already exists! Try `parcel-link unlink` to re-link.',
        );
        process.exit(1);
      }

      parcelLinkConfig = new ParcelLinkConfig({
        appRoot,
        packageRoot: packageRoot ?? path.join(__dirname, '../../../'),
        namespace: options.namespace,
        nodeModulesGlobs: Array.isArray(options.nodeModulesGlobs)
          ? options.nodeModulesGlobs
          : [options.nodeModulesGlobs],
      });

      await link(parcelLinkConfig, {dryRun: options.dryRun, log: console.log});

      if (!options.dryRun) await parcelLinkConfig.save();

      console.log('🎉 Linking successful');
    });

  program
    .command('unlink [packageRoot]')
    .description('Unlink a dev copy of Parcel into an app', {
      packageRoot:
        'Path to the Parcel package root\nDefaults to the package root containing this package',
    })
    .option('-d, --dry-run', 'Do not write any changes')
    .option('-f, --force-install', 'Force a reinstall after unlinking')
    .option(
      '-n, --namespace <namespace>',
      'Package namespace to restore',
      '@parcel',
    )
    .option(
      '-g, --node-modules-globs <globs...>',
      'Locations where node_modules should be unlinked in the app',
      'node_modules',
    )
    .action(async (packageRoot, options) => {
      if (options.dryRun) console.log('Dry run...');
      let appRoot = process.cwd();

      let parcelLinkConfig;
      try {
        parcelLinkConfig = await ParcelLinkConfig.load(appRoot);
      } catch (e) {
        // boop!
      }

      if (parcelLinkConfig) {
        await unlink(parcelLinkConfig, {
          dryRun: options.dryRun,
          forceInstall: options.forceInstall,
          log: console.log,
        });

        if (!options.dryRun) await parcelLinkConfig.delete();
      } else {
        console.error('A Parcel link could not be found!');
        process.exit(1);
      }

      console.log('🎉 Unlinking successful');
    });

  return program;
}
