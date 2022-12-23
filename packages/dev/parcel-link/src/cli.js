// @flow strict-local
/* eslint-disable no-console */

import type {FileSystem} from '@parcel/fs';

// $FlowFixMe[untyped-import]
import {version} from '../package.json';
import {ParcelLinkConfig} from './ParcelLinkConfig';
import {link as linkAction} from './link';
import {unlink as unlinkAction} from './unlink';
import {NodeFS} from '@parcel/fs';

import commander from 'commander';
import path from 'path';

export type ProgramOptions = {|
  +fs?: FileSystem,
  +link?: typeof linkAction,
  +unlink?: typeof unlinkAction,
|};

export function createProgram(opts?: ProgramOptions): commander.Command {
  const {
    fs = new NodeFS(),
    link = linkAction,
    unlink = unlinkAction,
  } = opts ?? {};

  const program = new commander.Command();

  program
    .version(version, '-V, --version')
    .description('A tool for linking a dev copy of Parcel into an app')
    .addHelpText('after', `\nThe link command is the default command.`);

  program
    .command('link [packageRoot]', {isDefault: true})
    .description('Link a dev copy of Parcel into an app', {
      packageRoot:
        'Path to the Parcel package root\nDefaults to the package root containing this package',
    })
    .option('-d, --dry-run', 'Do not write any changes')
    .option('-n, --namespace <namespace>', 'Namespace for packages', '@parcel')
    .option(
      '-g, --node-modules-glob <glob>',
      'Location where node_modules should be linked in the app.\nCan be repeated with multiple globs.',
      (glob, globs) => globs.concat([glob.replace(/["']/g, '')]),
      ['node_modules'],
    )
    .action(async (packageRoot, options) => {
      if (options.dryRun) console.log('Dry run...');
      let appRoot = process.cwd();

      let parcelLinkConfig;

      try {
        parcelLinkConfig = await ParcelLinkConfig.load(appRoot, {fs});
      } catch (e) {
        // boop!
      }

      if (parcelLinkConfig) {
        throw new Error(
          'A Parcel link already exists! Try `parcel-link unlink` to re-link.',
        );
      }

      parcelLinkConfig = new ParcelLinkConfig({
        fs,
        appRoot,
        packageRoot: packageRoot ?? path.join(__dirname, '../../../'),
        namespace: options.namespace,
        nodeModulesGlobs: options.nodeModulesGlob,
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
        parcelLinkConfig = await ParcelLinkConfig.load(appRoot, {fs});
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
        throw new Error('A Parcel link could not be found!');
      }

      console.log('🎉 Unlinking successful');
    });

  return program;
}
